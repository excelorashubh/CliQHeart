import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientSession } from 'mongoose';
import {
  changeFollowRelationship,
  FollowAccountUnavailableError,
  type FollowMutationDependencies,
} from './follow.service';

function createSession() {
  let ended = false;
  const session = {
    withTransaction: async (operation: () => Promise<unknown>) => operation(),
    endSession: async () => { ended = true; },
  } as unknown as ClientSession;
  return { session, ended: () => ended };
}

test('concurrent duplicate follows create one relationship and one notification', async () => {
  const activeUsers = new Set(['follower', 'target']);
  const relationships = new Set<string>();
  const notifications: string[] = [];
  const session = createSession();
  let generatedId = 0;
  const dependencies: FollowMutationDependencies = {
    startSession: async () => session.session,
    lockActiveUsers: async (ids) => ids.every((id) => activeUsers.has(id)),
    createFollow: async (followerId, followedId) => {
      const key = `${followerId}:${followedId}`;
      if (relationships.has(key)) return {};
      relationships.add(key);
      generatedId += 1;
      return { createdId: `edge-${generatedId}` };
    },
    deleteFollow: async (followerId, followedId) => {
      relationships.delete(`${followerId}:${followedId}`);
    },
    createFollowNotification: async (_recipientId, _actorId, createdId) => {
      notifications.push(createdId);
    },
  };

  await Promise.all([
    changeFollowRelationship('follower', 'target', true, dependencies),
    changeFollowRelationship('follower', 'target', true, dependencies),
  ]);

  assert.deepEqual([...relationships], ['follower:target']);
  assert.deepEqual(notifications, ['edge-1']);
  assert.equal(session.ended(), true);
});

test('follow rechecks active accounts while acquiring transaction locks', async () => {
  let targetActive = true;
  let edgeCreated = false;
  let notificationCreated = false;
  const session = createSession();
  const dependencies: FollowMutationDependencies = {
    startSession: async () => session.session,
    lockActiveUsers: async (ids) => ids.every((id) => id !== 'target' || targetActive),
    createFollow: async () => {
      edgeCreated = true;
      return { createdId: 'edge-id' };
    },
    deleteFollow: async () => {},
    createFollowNotification: async () => { notificationCreated = true; },
  };
  targetActive = false;

  await assert.rejects(
    () => changeFollowRelationship('follower', 'target', true, dependencies),
    FollowAccountUnavailableError,
  );
  assert.equal(edgeCreated, false);
  assert.equal(notificationCreated, false);
  assert.equal(session.ended(), true);
});
