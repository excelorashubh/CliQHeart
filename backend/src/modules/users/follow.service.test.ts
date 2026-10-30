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
  const publishedNotificationCounts: string[] = [];
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
      return true;
    },
    publishNotificationUnreadCount: async (recipientId) => {
      publishedNotificationCounts.push(recipientId);
    },
  };

  await Promise.all([
    changeFollowRelationship('follower', 'target', true, dependencies),
    changeFollowRelationship('follower', 'target', true, dependencies),
  ]);

  assert.deepEqual([...relationships], ['follower:target']);
  assert.deepEqual(notifications, ['edge-1']);
  assert.deepEqual(publishedNotificationCounts, ['target']);
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
    createFollowNotification: async () => { notificationCreated = true; return true; },
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

function mutualFollowHarness() {
  const activeUsers = new Set(['user-a', 'user-b']);
  const relationships = new Set<string>();
  const conversations = new Map<string, string>();
  const published: string[] = [];
  let nextConversationId = 0;
  const dependencies: FollowMutationDependencies = {
    startSession: async () => createSession().session,
    lockActiveUsers: async (ids) => ids.every((id) => activeUsers.has(id)),
    createFollow: async (followerId, followedId) => {
      const pair = `${followerId}:${followedId}`;
      if (relationships.has(pair)) return {};
      relationships.add(pair);
      return { createdId: pair };
    },
    deleteFollow: async (followerId, followedId) => {
      const pair = `${followerId}:${followedId}`;
      relationships.delete(pair);
      return pair;
    },
    createFollowNotification: async () => false,
    ensureMutualConversation: async (firstUserId, secondUserId) => {
      if (!relationships.has(`${secondUserId}:${firstUserId}`)) return undefined;
      const pair = [firstUserId, secondUserId].sort().join(':');
      const existing = conversations.get(pair);
      if (existing) return { conversationId: existing, created: false };
      nextConversationId += 1;
      const conversationId = `conversation-${nextConversationId}`;
      conversations.set(pair, conversationId);
      return { conversationId, created: true };
    },
    publishConversationCreated: (conversationId) => published.push(conversationId),
  };
  return { dependencies, relationships, conversations, published };
}

test('only the follow-back creates a reusable conversation and unfollow preserves it', async () => {
  const state = mutualFollowHarness();

  await changeFollowRelationship('user-a', 'user-b', true, state.dependencies);
  assert.equal(state.conversations.size, 0);
  assert.deepEqual(state.published, []);

  await changeFollowRelationship('user-b', 'user-a', true, state.dependencies);
  assert.equal(state.conversations.size, 1);
  assert.deepEqual(state.published, ['conversation-1']);

  await changeFollowRelationship('user-b', 'user-a', true, state.dependencies);
  assert.equal(state.conversations.size, 1);
  assert.deepEqual(state.published, ['conversation-1']);

  await changeFollowRelationship('user-a', 'user-b', false, state.dependencies);
  assert.equal(state.conversations.get('user-a:user-b'), 'conversation-1');
});

test('simultaneous mutual follow requests create and publish one conversation', async () => {
  const state = mutualFollowHarness();

  await Promise.all([
    changeFollowRelationship('user-a', 'user-b', true, state.dependencies),
    changeFollowRelationship('user-b', 'user-a', true, state.dependencies),
  ]);

  assert.equal(state.relationships.size, 2);
  assert.equal(state.conversations.size, 1);
  assert.deepEqual(state.published, ['conversation-1']);
});
