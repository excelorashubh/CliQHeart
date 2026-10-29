import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientSession } from 'mongoose';
import {
  deleteAccount,
  type AccountDeletionDependencies,
} from './account-deletion.service';

const deletedUserId = 'deleted-user';

function makeSession(
  transaction: (operation: () => Promise<unknown>) => Promise<unknown> =
    async (operation) => operation(),
) {
  let ended = false;
  const session = {
    withTransaction: transaction,
    endSession: async () => { ended = true; },
  } as unknown as ClientSession;
  return { session, ended: () => ended };
}

test('deletion removes incoming and outgoing follow edges and derived counts update exactly', async () => {
  const relationships = [
    { followerId: 'incoming-one', followedId: deletedUserId },
    { followerId: 'incoming-two', followedId: deletedUserId },
    { followerId: deletedUserId, followedId: 'outgoing-one' },
    { followerId: 'unrelated-follower', followedId: 'unrelated-target' },
  ];
  const notifications = [
    { actorId: deletedUserId, recipientId: 'incoming-one' },
    { actorId: 'outgoing-one', recipientId: deletedUserId },
    { actorId: 'unrelated-follower', recipientId: 'unrelated-target' },
  ];
  let accountStatus = 'active';
  const session = makeSession();
  const dependencies: AccountDeletionDependencies = {
    startSession: async () => session.session,
    markDeleted: async (id) => {
      assert.equal(id, deletedUserId);
      accountStatus = 'deleted';
    },
    deleteFollowEdges: async (id) => {
      assert.equal(id, deletedUserId);
      for (let index = relationships.length - 1; index >= 0; index -= 1) {
        const relation = relationships[index]!;
        if (relation.followerId === id || relation.followedId === id) relationships.splice(index, 1);
      }
    },
    revokeSessions: async (id, revokedAt) => {
      assert.equal(id, deletedUserId);
      assert.ok(revokedAt instanceof Date);
    },
    deleteNotifications: async (id) => {
      for (let index = notifications.length - 1; index >= 0; index -= 1) {
        const notification = notifications[index]!;
        if (notification.actorId === id || notification.recipientId === id) notifications.splice(index, 1);
      }
    },
  };

  await deleteAccount(deletedUserId, dependencies);
  const followerCount = (id: string) => relationships.filter((edge) => edge.followedId === id).length;
  const followingCount = (id: string) => relationships.filter((edge) => edge.followerId === id).length;

  assert.equal(accountStatus, 'deleted');
  assert.deepEqual(relationships, [
    { followerId: 'unrelated-follower', followedId: 'unrelated-target' },
  ]);
  assert.equal(followingCount('incoming-one'), 0);
  assert.equal(followingCount('incoming-two'), 0);
  assert.equal(followerCount('outgoing-one'), 0);
  assert.equal(followerCount('unrelated-target'), 1);
  assert.equal(followingCount('unrelated-follower'), 1);
  assert.deepEqual(notifications, [
    { actorId: 'unrelated-follower', recipientId: 'unrelated-target' },
  ]);
  assert.equal(session.ended(), true);
});

test('retries are idempotent and do not decrement stored counters', async () => {
  const relationships = [{ followerId: 'follower', followedId: deletedUserId }];
  let deleteCalls = 0;
  const session = makeSession();
  const dependencies: AccountDeletionDependencies = {
    startSession: async () => session.session,
    markDeleted: async () => {},
    deleteFollowEdges: async (id) => {
      deleteCalls += 1;
      for (let index = relationships.length - 1; index >= 0; index -= 1) {
        if (relationships[index]?.followerId === id || relationships[index]?.followedId === id) {
          relationships.splice(index, 1);
        }
      }
    },
    revokeSessions: async () => {},
    deleteNotifications: async () => {},
  };

  await deleteAccount(deletedUserId, dependencies);
  await deleteAccount(deletedUserId, dependencies);

  assert.equal(deleteCalls, 2);
  assert.deepEqual(relationships, []);
});

test('standalone Mongo fallback uses idempotent cleanup before soft deletion', async () => {
  const operations: string[] = [];
  const fallbackError = Object.assign(new Error('Transaction numbers are only allowed on a replica set'), { code: 20 });
  const session = makeSession(async () => { throw fallbackError; });
  const dependencies: AccountDeletionDependencies = {
    startSession: async () => session.session,
    deleteFollowEdges: async (_id, transactionSession) => {
      operations.push(transactionSession ? 'transaction-follow-delete' : 'fallback-follow-delete');
    },
    deleteNotifications: async (_id, transactionSession) => {
      operations.push(transactionSession ? 'transaction-notifications' : 'fallback-notifications');
    },
    markDeleted: async (_id, transactionSession) => {
      operations.push(transactionSession ? 'transaction-soft-delete' : 'fallback-soft-delete');
    },
    revokeSessions: async (_id, _date, transactionSession) => {
      operations.push(transactionSession ? 'transaction-revoke' : 'fallback-revoke');
    },
  };

  await deleteAccount(deletedUserId, dependencies);

  assert.deepEqual(operations, [
    'fallback-follow-delete',
    'fallback-notifications',
    'fallback-revoke',
    'fallback-soft-delete',
  ]);
  assert.equal(session.ended(), true);
});

test('interrupted standalone cleanup can be retried without changing unrelated relationships', async () => {
  const relationships = [
    { followerId: 'incoming', followedId: deletedUserId },
    { followerId: 'unrelated', followedId: 'unrelated-target' },
  ];
  const session = makeSession(async () => {
    throw Object.assign(new Error('Transactions are not supported by this server'), { code: 20 });
  });
  let accountStatus = 'active';
  let notificationAttempt = 0;
  const dependencies: AccountDeletionDependencies = {
    startSession: async () => session.session,
    deleteFollowEdges: async (id) => {
      for (let index = relationships.length - 1; index >= 0; index -= 1) {
        const relation = relationships[index]!;
        if (relation.followerId === id || relation.followedId === id) relationships.splice(index, 1);
      }
    },
    deleteNotifications: async () => {
      notificationAttempt += 1;
      if (notificationAttempt === 1) throw new Error('Temporary notification store failure');
    },
    markDeleted: async () => { accountStatus = 'deleted'; },
    revokeSessions: async () => {},
  };

  await assert.rejects(() => deleteAccount(deletedUserId, dependencies), /could not be completed safely/i);
  assert.equal(accountStatus, 'active');
  assert.deepEqual(relationships, [
    { followerId: 'unrelated', followedId: 'unrelated-target' },
  ]);
  await deleteAccount(deletedUserId, dependencies);

  assert.equal(accountStatus, 'deleted');
  assert.deepEqual(relationships, [
    { followerId: 'unrelated', followedId: 'unrelated-target' },
  ]);
});

test('transaction failure is surfaced and the session is always closed', async () => {
  const session = makeSession(async () => { throw new Error('transaction failed'); });
  const dependencies: AccountDeletionDependencies = {
    startSession: async () => session.session,
    markDeleted: async () => assert.fail('must not run outside failed transaction'),
    deleteFollowEdges: async () => assert.fail('must not run outside failed transaction'),
    revokeSessions: async () => assert.fail('must not run outside failed transaction'),
    deleteNotifications: async () => assert.fail('must not run outside failed transaction'),
  };

  await assert.rejects(() => deleteAccount(deletedUserId, dependencies), /could not be completed safely/i);
  assert.equal(session.ended(), true);
});
