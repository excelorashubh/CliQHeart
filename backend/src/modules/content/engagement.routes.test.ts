import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Types } from 'mongoose';
import { loadConfig } from '../../config/env';
import { createApp } from '../../app';
import { UserModel } from '../../models/user';
import { MediaModel } from '../media/media.model';
import { NotificationModel } from '../notifications/notification.model';
import { LikeModel } from './engagement.models';
import { PostModel } from './post.model';

const actorId = '0123456789abcdef01234567';
const ownerId = '1123456789abcdef01234567';
const postId = 'abcdefabcdefabcdefabcdef';
const secret = 'test-jwt-access-secret-at-least-32-chars-long';
const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
  JWT_ACCESS_SECRET: secret,
});

function createAuthenticatedApp(t: TestContext) {
  t.mock.method(UserModel, 'findOne', () => ({
    select: () => ({ _id: actorId }),
  }));
  t.mock.method(PostModel, 'findById', () => ({
    select: () => ({
      lean: async () => ({ _id: postId, ownerId, mediaId: '2123456789abcdef01234567' }),
    }),
  }));
  t.mock.method(UserModel, 'exists', async () => true);
  t.mock.method(MediaModel, 'exists', async () => true);
  const token = jwt.sign(
    { sub: actorId, tokenType: 'access' },
    secret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );
  const app = createApp({
    config,
    databaseStatus: () => true,
    requestLogger: () => undefined,
  });
  return { app, token };
}

test('like retries remain idempotent and create a notification only once', async (t) => {
  const { app, token } = createAuthenticatedApp(t);
  const likedByActor = new Set<string>();
  const receivedFilters: Record<string, unknown>[] = [];
  const likeWrite = t.mock.method(LikeModel, 'updateOne', async (filter: Record<string, unknown>) => {
    receivedFilters.push(filter);
    const key = `${String(filter.userId)}:${String(filter.contentType)}:${String(filter.contentId)}`;
    if (likedByActor.has(key)) return { acknowledged: true, matchedCount: 1, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
    likedByActor.add(key);
    return {
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
      upsertedId: new Types.ObjectId('3123456789abcdef01234567'),
    };
  });
  const notificationWrite = t.mock.method(NotificationModel, 'updateOne', async () => ({
    acknowledged: true,
    matchedCount: 0,
    modifiedCount: 0,
    upsertedCount: 1,
    upsertedId: new Types.ObjectId(),
  }));
  t.mock.method(LikeModel, 'countDocuments', async () => 1);

  const first = await request(app)
    .post(`/api/v1/posts/${postId}/like`)
    .set('Authorization', `Bearer ${token}`);
  const retry = await request(app)
    .post(`/api/v1/posts/${postId}/like`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { liked: true, likeCount: 1 });
  assert.deepEqual(retry.body, { liked: true, likeCount: 1 });
  assert.equal(likeWrite.mock.calls.length, 2);
  const filter = receivedFilters[0];
  assert.ok(filter);
  assert.equal(filter.userId, actorId);
  assert.equal(filter.contentType, 'post');
  assert.equal(notificationWrite.mock.calls.length, 1);
});
