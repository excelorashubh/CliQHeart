import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { MediaModel } from '../media/media.model';
import { PostModel } from '../content/post.model';
import { ReelModel } from '../content/reel.model';
import { FollowModel } from './follow.model';
import { createUserRouter } from './user.routes';

const ownerId = '0123456789abcdef01234567';
const currentMediaId = 'abcdefabcdefabcdefabcdef';
const accessSecret = 'test-jwt-access-secret-at-least-32-chars-long';

function createTestApp(t: TestContext) {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    JWT_ACCESS_SECRET: accessSecret,
  });
  const savedUser = {
    _id: ownerId,
    username: 'test_user',
    displayName: 'Test User',
    bio: 'Updated bio',
    avatarUrl: 'https://res.cloudinary.com/test-cloud/image/upload/profile.jpg',
  };
  const currentUser = { _id: ownerId, avatarMediaId: currentMediaId };

  t.mock.method(UserModel, 'findOne', () => ({
    select: async () => ({ _id: ownerId }),
  }));
  t.mock.method(UserModel, 'findById', () => ({
    select: () => ({ lean: async () => ({ ...savedUser, ...currentUser }) }),
  }));
  const updateUser = t.mock.method(UserModel, 'findByIdAndUpdate', () => ({
    select: () => ({ lean: async () => savedUser }),
  }));
  const verifyMedia = t.mock.method(MediaModel, 'findOneAndUpdate', async () => null);
  t.mock.method(FollowModel, 'countDocuments', async () => 0);
  t.mock.method(PostModel, 'countDocuments', async () => 0);
  t.mock.method(ReelModel, 'countDocuments', async () => 0);

  const app = express();
  app.use(express.json(), createUserRouter(config));
  const token = jwt.sign(
    { sub: ownerId, tokenType: 'access' },
    accessSecret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );

  return {
    app,
    token,
    updateUser,
    verifyMedia,
  };
}

test('bio-only profile updates preserve the saved avatar without verification or cleanup', async (t) => {
  const { app, token, updateUser, verifyMedia } = createTestApp(t);
  const response = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ bio: 'Updated bio' });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.avatarUrl, 'https://res.cloudinary.com/test-cloud/image/upload/profile.jpg');
  const updateCall = updateUser.mock.calls.at(0);
  assert.ok(updateCall);
  assert.deepEqual(updateCall.arguments[1], { $set: { bio: 'Updated bio' } });
  assert.equal(verifyMedia.mock.calls.length, 0);
});

test('an already-saved avatar ID is treated as unchanged, not as a new upload', async (t) => {
  const { app, token, updateUser, verifyMedia } = createTestApp(t);
  const response = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarMediaId: currentMediaId });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.avatarUrl, 'https://res.cloudinary.com/test-cloud/image/upload/profile.jpg');
  assert.equal(updateUser.mock.calls.length, 0);
  assert.equal(verifyMedia.mock.calls.length, 0);
});

test('a submitted replacement must still be a verified image owned by the authenticated user', async (t) => {
  const { app, token, updateUser, verifyMedia } = createTestApp(t);
  const replacementId = 'fedcbafedcbafedcbafedcba';
  const response = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ bio: 'Updated bio', avatarMediaId: replacementId });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Choose a verified profile image owned by your account.');
  assert.equal(updateUser.mock.calls.length, 0);
  assert.equal(verifyMedia.mock.calls.length, 1);
  const verificationCall = verifyMedia.mock.calls.at(0);
  assert.ok(verificationCall);
  const verificationFilter = verificationCall.arguments[0];
  assert.ok(
    typeof verificationFilter === 'object' &&
    verificationFilter !== null &&
    'ownerId' in verificationFilter,
  );
  assert.equal(verificationFilter.ownerId, ownerId);
});

test('arbitrary avatar URLs are rejected and photo removal must be explicit', async (t) => {
  const { app, token, updateUser, verifyMedia } = createTestApp(t);
  const invalid = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarUrl: 'https://example.test/unverified.jpg' });
  assert.equal(invalid.status, 400);
  assert.equal(updateUser.mock.calls.length, 0);
  assert.equal(verifyMedia.mock.calls.length, 0);

  const removal = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarMediaId: null });
  assert.equal(removal.status, 200);
  const updateCall = updateUser.mock.calls.at(0);
  assert.ok(updateCall);
  assert.deepEqual(updateCall.arguments[1], {
    $unset: { avatarMediaId: 1, avatarUrl: 1 },
  });
  assert.equal(verifyMedia.mock.calls.length, 1);
});
