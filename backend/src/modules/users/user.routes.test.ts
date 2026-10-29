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
import type { CloudinaryMediaClient } from '../media/cloudinary';
import { FollowModel } from './follow.model';
import { createUserRouter } from './user.routes';

const ownerId = '0123456789abcdef01234567';
const currentMediaId = 'abcdefabcdefabcdefabcdef';
const accessSecret = 'test-jwt-access-secret-at-least-32-chars-long';

function createTestApp(
  t: TestContext,
  {
    cloudinaryClient,
    oldProfileMedia,
  }: { cloudinaryClient?: CloudinaryMediaClient; oldProfileMedia?: Record<string, unknown> } = {},
) {
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
  const updateUser = t.mock.method(UserModel, 'findByIdAndUpdate', (_id: unknown, update: unknown) => {
    const updatedUser = typeof update === 'object' &&
      update !== null &&
      '$unset' in update
      ? { ...savedUser, avatarUrl: undefined }
      : savedUser;
    return { select: () => ({ lean: async () => updatedUser }) };
  });
  const verifyMedia = t.mock.method(
    MediaModel,
    'findOneAndUpdate',
    async () => oldProfileMedia ?? null,
  );
  t.mock.method(MediaModel, 'updateOne', async () => ({ modifiedCount: 1 }));
  t.mock.method(FollowModel, 'countDocuments', async () => 0);
  t.mock.method(PostModel, 'countDocuments', async () => 0);
  t.mock.method(ReelModel, 'countDocuments', async () => 0);

  const app = express();
  app.use(express.json(), createUserRouter(config, cloudinaryClient));
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

test('confirmed removal deletes only the authenticated user managed profile asset', async (t) => {
  const ownedMedia = {
    _id: currentMediaId,
    ownerId,
    purpose: 'profile',
    resourceType: 'image',
    status: 'ready',
    attachedTo: 'profile',
    attachedId: ownerId,
    publicId: `cliqheart/profiles/${ownerId}/profile-photo`,
  };
  const destroy = t.mock.fn(async () => ({ result: 'ok' }));
  const cloudinaryClient: CloudinaryMediaClient = {
    sign: () => 'unused',
    resource: async () => ({}),
    destroy,
  };
  const { app, token, verifyMedia } = createTestApp(t, {
    cloudinaryClient,
    oldProfileMedia: ownedMedia,
  });
  const response = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarMediaId: null });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.avatarUrl, undefined);
  assert.equal(destroy.mock.calls.length, 1);
  const destroyCall = destroy.mock.calls.at(0);
  assert.ok(destroyCall);
  assert.deepEqual(destroyCall.arguments, [ownedMedia.publicId, 'image']);
  const deletionCall = verifyMedia.mock.calls.at(0);
  assert.ok(deletionCall);
  const deletionFilter = deletionCall.arguments[0];
  assert.ok(deletionFilter && typeof deletionFilter === 'object' && 'ownerId' in deletionFilter);
  assert.equal(deletionFilter.ownerId, ownerId);
  assert.equal(deletionFilter.purpose, 'profile');
  assert.equal(deletionFilter.attachedId, ownerId);
  assert.ok(Array.isArray(deletionFilter.$or));
});

test('unauthenticated requests cannot remove a profile photo', async (t) => {
  const { app, updateUser, verifyMedia } = createTestApp(t);
  const response = await request(app)
    .patch('/users/me')
    .send({ avatarMediaId: null });

  assert.equal(response.status, 401);
  assert.equal(updateUser.mock.calls.length, 0);
  assert.equal(verifyMedia.mock.calls.length, 0);
});

test('failed Cloudinary photo cleanup preserves the profile removal and returns a safe warning', async (t) => {
  const ownedMedia = {
    _id: currentMediaId,
    ownerId,
    purpose: 'profile',
    resourceType: 'image',
    status: 'ready',
    attachedTo: 'profile',
    attachedId: ownerId,
    publicId: `cliqheart/profiles/${ownerId}/profile-photo`,
  };
  const cloudinaryClient: CloudinaryMediaClient = {
    sign: () => 'unused',
    resource: async () => ({}),
    destroy: async () => {
      throw new Error('Provider credentials must not be returned.');
    },
  };
  const { app, token } = createTestApp(t, { cloudinaryClient, oldProfileMedia: ownedMedia });
  const response = await request(app)
    .patch('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarMediaId: null });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.avatarUrl, undefined);
  assert.match(response.body.photoCleanupWarning, /could not be deleted/i);
  assert.doesNotMatch(JSON.stringify(response.body), /Provider credentials/);
});

test('suggestions contain active accounts excluding the viewer and their followed users', async (t) => {
  const { app, token } = createTestApp(t);
  const followedId = 'fedcbafedcbafedcbafedcba';
  const suggestionId = 'abcdefabcdefabcdefabcdef';
  const followFilters: unknown[] = [];
  const followedFilter = t.mock.method(FollowModel, 'find', (filter: unknown) => {
    followFilters.push(filter);
    return {
      select() { return this; },
      lean: async () => typeof filter === 'object' && filter !== null && 'followedId' in filter
          ? [{ followerId: followedId, followedId: suggestionId }]
          : [{ followedId }],
    };
  });
  let actualUserFilter: unknown;
  const candidateFilter = t.mock.method(UserModel, 'find', (filter: unknown) => {
    actualUserFilter = filter;
    return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => {
      if (
        typeof filter === 'object' &&
        filter !== null &&
        '_id' in filter &&
        typeof filter._id === 'object' &&
        filter._id !== null &&
        '$in' in filter._id
      ) return [{ _id: followedId, username: 'mutual_friend' }];
      return [{
        _id: suggestionId,
        username: 'suggested_user',
        displayName: 'Suggested User',
        avatarUrl: 'https://res.cloudinary.com/test-cloud/image/upload/avatar.jpg',
      }];
    },
    };
  });

  const response = await request(app)
    .get('/users/suggestions?limit=5')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.users, [{
    id: suggestionId,
    username: 'suggested_user',
    displayName: 'Suggested User',
    avatarUrl: 'https://res.cloudinary.com/test-cloud/image/upload/avatar.jpg',
    isFollowing: false,
    mutualCount: 1,
    mutualUsernames: ['mutual_friend'],
  }]);
  assert.equal(followedFilter.mock.calls.length, 2);
  assert.equal(candidateFilter.mock.calls.length, 2);
  assert.deepEqual(followFilters[0], { followerId: ownerId });
  const userFilter = actualUserFilter;
  assert.deepEqual(userFilter, { _id: { $in: [followedId] }, accountStatus: 'active' });
  const suggestionQuery = candidateFilter.mock.calls[0]?.arguments[0];
  assert.deepEqual(suggestionQuery, {
    accountStatus: 'active',
    _id: { $nin: [ownerId, followedId] },
  });
  assert.equal(response.body.nextCursor, null);
});

test('suggestions use the username cursor and a bounded page size', async (t) => {
  const { app, token } = createTestApp(t);
  t.mock.method(FollowModel, 'find', (filter: unknown) => ({
    select() { return this; },
    lean: async () => typeof filter === 'object' && filter !== null && 'followedId' in filter ? [] : [],
  }));
  let queriedFilter: unknown;
  let queriedLimit = 0;
  t.mock.method(UserModel, 'find', (filter: unknown) => {
    queriedFilter = filter;
    return {
      select() { return this; },
      sort() { return this; },
      limit(value: number) { queriedLimit = value; return this; },
      lean: async () => [
        { _id: '111111111111111111111111', username: 'first_person', displayName: 'First' },
        { _id: '222222222222222222222222', username: 'second_person', displayName: 'Second' },
      ],
    };
  });

  const response = await request(app)
    .get('/users/suggestions?limit=1&after=previous_person')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(queriedLimit, 2);
  assert.deepEqual(queriedFilter, {
    accountStatus: 'active',
    _id: { $nin: [ownerId] },
    username: { $gt: 'previous_person' },
  });
  assert.equal(response.body.users.length, 1);
  assert.equal(response.body.nextCursor, 'first_person');
});
