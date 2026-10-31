import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Types } from 'mongoose';
import { loadConfig } from '../../config/env';
import { createApp } from '../../app';
import { UserModel } from '../../models/user';
import { FollowModel } from '../users/follow.model';
import { MediaModel } from '../media/media.model';
import { PostModel } from './post.model';
import { ReelModel } from './reel.model';
import { HashtagModel } from './hashtag.model';
import { StoryModel } from './story.model';
import { StoryLikeModel, StoryViewModel } from './story-engagement.models';
import { createContentRouter } from './content.routes';

const userId = '0123456789abcdef01234567';
const jwtSecret = 'test-jwt-access-secret-at-least-32-chars-long';
const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
  JWT_ACCESS_SECRET: jwtSecret,
});
const mediaIds = {
  post: 'abcdefabcdefabcdefabcdef',
  reel: 'bcdefabcdefabcdefabcdefa',
  story: 'cdefabcdefabcdefabcdefab',
};
const owner = {
  _id: userId,
  username: 'test_user',
  displayName: 'Test User',
  avatarUrl: null,
};

function buildApp(t: TestContext, verifiedMedia?: Record<string, unknown> | null) {
  t.mock.method(UserModel, 'findOne', () => ({
    select: () => ({ lean: async () => owner }),
  }));
  const media = verifiedMedia === undefined
    ? {
      _id: new Types.ObjectId(mediaIds.post),
      resourceType: 'image',
      secureUrl: 'https://res.cloudinary.com/test/image/upload/post.jpg',
      thumbnailUrl: null,
      format: 'jpg',
      bytes: 1024,
      width: 800,
      height: 600,
      duration: null,
    }
    : verifiedMedia;
  const claimMedia = t.mock.method(
    MediaModel,
    'findOneAndUpdate',
    async () => media,
  );
  const app = createApp({
    config,
    databaseStatus: () => true,
    requestLogger: () => undefined,
  });
  const token = jwt.sign(
    { sub: userId, tokenType: 'access' },
    jwtSecret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );
  return { app, token, claimMedia };
}

function createContentApp(t: TestContext) {
  const { app, token, claimMedia } = buildApp(t);
  const media = {
    _id: new Types.ObjectId(mediaIds.post),
    resourceType: 'image',
    secureUrl: 'https://res.cloudinary.com/test/image/upload/post.jpg',
    thumbnailUrl: null,
    format: 'jpg',
    bytes: 1024,
    width: 800,
    height: 600,
    duration: null,
  };
  return { app, token, claimMedia, media };
}

test('post publishing accepts the JSON mediaId, caption, location, and altText contract', async (t) => {
  const { app, token, media } = createContentApp(t);
  const createPost = t.mock.method(PostModel, 'create', async (fields: Record<string, unknown>) => ({
    ...fields,
    createdAt: new Date(),
  }));
  const response = await request(app)
    .post('/api/v1/posts')
    .set('Authorization', `Bearer ${token}`)
    .send({
      mediaId: mediaIds.post,
      caption: 'A real moment',
      location: 'Lisbon',
      altText: 'Friends at the coast',
    });

  assert.equal(response.status, 201);
  assert.equal(createPost.mock.calls.length, 1);
  assert.equal(response.body.post.media.id, String(media._id));
  assert.equal(response.body.post.caption, 'A real moment');
  assert.equal(response.body.post.location, 'Lisbon');
  assert.equal(response.body.post.altText, 'Friends at the coast');
});

test('post publishing persists unique case-insensitive hashtags and increments popularity', async (t) => {
  const { app, token } = createContentApp(t);
  let createdFields: Record<string, unknown> = {};
  t.mock.method(PostModel, 'create', async (fields: Record<string, unknown>) => {
    createdFields = fields;
    return { ...fields, createdAt: new Date() };
  });
  const updateHashtag = t.mock.method(HashtagModel, 'updateOne', async () => ({ matchedCount: 1 }));
  const response = await request(app)
    .post('/api/v1/posts')
    .set('Authorization', `Bearer ${token}`)
    .send({ mediaId: mediaIds.post, caption: '#Photography #Travel #photography' });

  assert.equal(response.status, 201);
  assert.deepEqual(createdFields.hashtags, ['photography', 'travel']);
  assert.deepEqual(updateHashtag.mock.calls.map((call) => call.arguments[0]), [
    { normalizedName: 'photography' },
    { normalizedName: 'travel' },
  ]);
  assert.equal(response.body.post.caption, '#Photography #Travel #photography');
  assert.deepEqual(response.body.post.hashtags, ['photography', 'travel']);
});

test('content rejects more than 30 unique hashtags', async (t) => {
  const { app, token, claimMedia } = createContentApp(t);
  const hashtags = Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(' ');
  const response = await request(app)
    .post('/api/v1/posts')
    .set('Authorization', `Bearer ${token}`)
    .send({ mediaId: mediaIds.post, caption: hashtags });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Invalid content request.');
  assert.ok(response.body.details.some((detail: { field: string; message: string }) =>
    detail.field === 'caption' && /30 unique hashtags/i.test(detail.message)));
  assert.equal(claimMedia.mock.calls.length, 0);
});

test('editing a post updates stored hashtags and adjusts only changed popularity counts', async (t) => {
  const { app, token, media } = createContentApp(t);
  const existing = {
    _id: new Types.ObjectId(mediaIds.post),
    ownerId: new Types.ObjectId(userId),
    mediaId: media._id,
    caption: '#Travel #Photography',
    hashtags: ['travel', 'photography'],
  };
  t.mock.method(PostModel, 'findOne', () => ({ lean: async () => existing }));
  const edited = { ...existing, caption: '#Travel #Tech', hashtags: ['travel', 'tech'] };
  t.mock.method(PostModel, 'findOneAndUpdate', () => ({ lean: async () => edited }));
  t.mock.method(MediaModel, 'findById', () => ({ lean: async () => media }));
  const updateHashtag = t.mock.method(HashtagModel, 'updateOne', async () => ({ matchedCount: 1 }));

  const response = await request(app)
    .patch(`/api/v1/posts/${mediaIds.post}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ caption: '#Travel #Tech' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.post.hashtags, ['travel', 'tech']);
  assert.deepEqual(updateHashtag.mock.calls.map((call) => call.arguments[0]), [
    { normalizedName: 'tech' },
    { normalizedName: 'photography', usageCount: { $gt: 0 } },
  ]);
});

test('hashtag search uses normalized backend records and returns popularity counts', async (t) => {
  const { app, token } = createContentApp(t);
  const hashtag = { name: 'travel', normalizedName: 'travel', usageCount: 7 };
  let lookupFilter: Record<string, unknown> | undefined;
  t.mock.method(HashtagModel, 'find', (filter: Record<string, unknown>) => {
    lookupFilter = filter;
    return {
      sort: () => ({ limit: () => ({ lean: async () => [hashtag] }) }),
    };
  });
  const response = await request(app)
    .get('/api/v1/hashtags/search?q=%23Tra')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.hashtags[0].normalizedName, 'travel');
  assert.equal(response.body.hashtags[0].usageCount, 7);
  assert.deepEqual(lookupFilter, {
    normalizedName: { $regex: '^tra' },
    usageCount: { $gt: 0 },
  });
});

test('Reel publishing requires verified video media and accepts its supported metadata', async (t) => {
  const reelMedia = {
    _id: new Types.ObjectId(mediaIds.reel),
    resourceType: 'video',
    secureUrl: 'https://res.cloudinary.com/test/video/upload/reel.mp4',
    thumbnailUrl: 'https://res.cloudinary.com/test/video/upload/reel.jpg',
    format: 'mp4',
    bytes: 2048,
    width: 720,
    height: 1280,
    duration: 30,
  };
  const { app, token, claimMedia } = buildApp(t, reelMedia);
  const createReel = t.mock.method(ReelModel, 'create', async (fields: Record<string, unknown>) => ({
    ...fields,
    createdAt: new Date(),
  }));
  const response = await request(app)
    .post('/api/v1/reels')
    .set('Authorization', `Bearer ${token}`)
    .send({
      mediaId: mediaIds.reel,
      caption: 'A short video',
      location: 'Studio',
      aiDisclosure: true,
    });

  assert.equal(response.status, 201);
  assert.equal(createReel.mock.calls.length, 1);
  const claimFilter = JSON.stringify(claimMedia.mock.calls[0]?.arguments[0]);
  assert.match(claimFilter, /"purpose":"reel"/);
  assert.match(claimFilter, /"resourceType":\{"\$in":\["video"\]\}/);
  assert.equal(response.body.reel.media.resourceType, 'video');
  assert.equal(response.body.reel.location, 'Studio');
  assert.equal(response.body.reel.aiDisclosure, true);
});

test('Reel publishing accepts durations up to 180 seconds and rejects longer or unverified durations', async (t) => {
  const reelMedia = {
    _id: new Types.ObjectId(mediaIds.reel),
    resourceType: 'video',
    secureUrl: 'https://res.cloudinary.com/test/video/upload/reel.mp4',
    thumbnailUrl: 'https://res.cloudinary.com/test/video/upload/reel.jpg',
    format: 'mp4',
    bytes: 2048,
    width: 720,
    height: 1280,
    duration: 35 as number | null,
  };
  const { app, token } = buildApp(t, reelMedia);
  const createReel = t.mock.method(ReelModel, 'create', async (fields: Record<string, unknown>) => ({
    ...fields,
    createdAt: new Date(),
  }));
  t.mock.method(MediaModel, 'updateOne', async () => ({ modifiedCount: 1 }));

  for (const duration of [0.001, 35, 179.9, 180]) {
    reelMedia.duration = duration;
    const response = await request(app)
      .post('/api/v1/reels')
      .set('Authorization', `Bearer ${token}`)
      .send({ mediaId: mediaIds.reel, caption: '' });
    assert.equal(response.status, 201, `${duration} seconds should be accepted`);
  }

  for (const duration of [180.1, 200]) {
    reelMedia.duration = duration;
    const response = await request(app)
      .post('/api/v1/reels')
      .set('Authorization', `Bearer ${token}`)
      .send({ mediaId: mediaIds.reel, caption: '' });
    assert.equal(response.status, 409, `${duration} seconds should be rejected`);
    assert.match(response.body.error, /no longer than 180 seconds/i);
  }

  for (const duration of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    reelMedia.duration = duration;
    const response = await request(app)
      .post('/api/v1/reels')
      .set('Authorization', `Bearer ${token}`)
      .send({ mediaId: mediaIds.reel, caption: '' });
    assert.equal(response.status, 409);
    assert.match(response.body.error, /could not verify.*duration/i);
  }
  assert.equal(createReel.mock.calls.length, 4);
});

test('story publishing accepts its JSON contract and returns its server expiration', async (t) => {
  const { app, token } = createContentApp(t);
  const createStory = t.mock.method(StoryModel, 'create', async (fields: Record<string, unknown>) => ({
    ...fields,
    createdAt: new Date(),
  }));
  const response = await request(app)
    .post('/api/v1/stories')
    .set('Authorization', `Bearer ${token}`)
    .send({ mediaId: mediaIds.story, caption: 'A short story' });

  assert.equal(response.status, 201);
  assert.equal(createStory.mock.calls.length, 1);
  assert.equal(response.body.story.caption, 'A short story');
  assert.ok(Date.parse(response.body.story.expiresAt) > Date.now());
});

test('publishing rejects missing fields and malformed media IDs with safe field details', async (t) => {
  const { app, token, claimMedia } = createContentApp(t);
  for (const [path, body, expectedField] of [
    ['/posts', { caption: 'Missing upload' }, 'mediaId'],
    ['/reels', { mediaId: 'not-an-object-id', caption: 'Bad upload id' }, 'mediaId'],
    ['/stories', { mediaId: mediaIds.story, caption: 'x'.repeat(501) }, 'caption'],
    ['/reels', { mediaId: mediaIds.reel, caption: '', mediaUrl: 'https://untrusted.invalid/video.mp4' }, 'mediaUrl'],
  ] as const) {
    const response = await request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Invalid content request.');
    assert.ok(response.body.requestId);
    assert.ok(response.body.details.some((issue: { field: string }) => issue.field === expectedField));
  }
  assert.equal(claimMedia.mock.calls.length, 0);
});

test('publishing reports unsupported media ownership or type as a conflict', async (t) => {
  const { app, token, claimMedia } = buildApp(t, null);
  const response = await request(app)
    .post('/api/v1/reels')
    .set('Authorization', `Bearer ${token}`)
    .send({ mediaId: mediaIds.reel, caption: 'Not a verified video' });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /verified video/i);
  const claimFilter = JSON.stringify(claimMedia.mock.calls[0]?.arguments[0]);
  assert.match(claimFilter, /"purpose":"reel"/);
  assert.match(claimFilter, /"resourceType":\{"\$in":\["video"\]\}/);
});

test('post, Reel, and Story publishing require authentication', async () => {
  const app = express();
  app.use(express.json(), createContentRouter(config));
  const responses = await Promise.all([
    request(app).post('/posts').send({ mediaId: mediaIds.post, caption: '' }),
    request(app).post('/reels').send({ mediaId: mediaIds.reel, caption: '' }),
    request(app).post('/stories').send({ mediaId: mediaIds.story, caption: '' }),
    request(app).post(`/stories/${mediaIds.story}/view`),
    request(app).get(`/stories/${mediaIds.story}/views`),
    request(app).post(`/stories/${mediaIds.story}/like`),
    request(app).post(`/stories/${mediaIds.story}/reactions`).send({ emoji: '❤️' }),
    request(app).post(`/stories/${mediaIds.story}/report`).send({ reason: 'unsafe' }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401, 401, 401, 401, 401]);
});

test('Stories feed serializes active Stories for the viewer and followed owners', async (t) => {
  const { app, token } = buildApp(t);
  const followedOwnerId = 'fedcbafedcbafedcbafedcba';
  const stories = [
    {
      _id: new Types.ObjectId(),
      ownerId: new Types.ObjectId(userId),
      mediaId: new Types.ObjectId(mediaIds.story),
      caption: 'Own story',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      _id: new Types.ObjectId(),
      ownerId: new Types.ObjectId(followedOwnerId),
      mediaId: new Types.ObjectId(mediaIds.reel),
      caption: 'Followed story',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ];
  let followFilter: unknown;
  t.mock.method(FollowModel, 'find', (filter: unknown) => {
    followFilter = filter;
    return {
      select() { return this; },
      lean: async () => [{ followedId: new Types.ObjectId(followedOwnerId) }],
    };
  });
  let storyFilter: unknown;
  t.mock.method(StoryModel, 'find', (filter: unknown) => {
    storyFilter = filter;
    return {
      sort() { return this; },
      limit() { return this; },
      lean: async () => stories,
    };
  });
  t.mock.method(StoryViewModel, 'find', () => ({
    select() { return this; },
    lean: async () => [],
  }));
  t.mock.method(UserModel, 'find', () => ({
    select() { return this; },
    lean: async () => [
      { _id: new Types.ObjectId(userId), username: 'viewer', displayName: 'Viewer' },
      { _id: new Types.ObjectId(followedOwnerId), username: 'followed', displayName: 'Followed' },
    ],
  }));
  t.mock.method(MediaModel, 'find', () => ({
    lean: async () => [
      {
        _id: new Types.ObjectId(mediaIds.story),
        resourceType: 'image',
        secureUrl: 'https://res.cloudinary.com/test/image/upload/own.jpg',
      },
      {
        _id: new Types.ObjectId(mediaIds.reel),
        resourceType: 'image',
        secureUrl: 'https://res.cloudinary.com/test/image/upload/followed.jpg',
      },
    ],
  }));

  const response = await request(app)
    .get('/api/v1/stories')
    .auth(token, { type: 'bearer' });

  assert.equal(response.status, 200);
  assert.deepEqual(followFilter, { followerId: userId });
  const actualStoryFilter = storyFilter as {
    ownerId: { $in: string[] };
    expiresAt: { $gt: Date };
  };
  assert.deepEqual(actualStoryFilter.ownerId.$in, [userId, followedOwnerId]);
  assert.ok(actualStoryFilter.expiresAt.$gt instanceof Date);
  assert.deepEqual(
    response.body.stories.map((story: { caption: string; owner: { username: string }; isViewed: boolean }) => ({
      caption: story.caption,
      owner: story.owner.username,
      isViewed: story.isViewed,
    })),
    [
      { caption: 'Own story', owner: 'viewer', isViewed: false },
      { caption: 'Followed story', owner: 'followed', isViewed: false },
    ],
  );
});

test('story view writes are idempotent and only the owner can load viewer identities', async (t) => {
  const { app, token: ownerToken } = buildApp(t);
  const viewerId = '1123456789abcdef01234567';
  const viewerToken = jwt.sign(
    { sub: viewerId, tokenType: 'access' },
    jwtSecret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );
  const story = {
    _id: new Types.ObjectId(mediaIds.story),
    ownerId: new Types.ObjectId(userId),
    mediaId: new Types.ObjectId(mediaIds.post),
    expiresAt: new Date(Date.now() + 60_000),
  };
  t.mock.method(StoryModel, 'findOne', (filter: Record<string, unknown>) => ({
    select: () => ({ lean: async () => String(filter.ownerId ?? story.ownerId) === String(story.ownerId) ? story : null }),
    lean: async () => story,
  }));
  t.mock.method(UserModel, 'exists', async () => true);
  t.mock.method(FollowModel, 'exists', async () => true);
  const viewedIds = new Set<string>();
  t.mock.method(StoryViewModel, 'updateOne', async (filter: Record<string, unknown>) => {
    viewedIds.add(String(filter.viewerId));
    return { upsertedCount: 1 };
  });
  t.mock.method(StoryViewModel, 'countDocuments', async () => viewedIds.size);
  t.mock.method(StoryLikeModel, 'exists', async () => false);
  t.mock.method(StoryViewModel, 'find', () => ({
    sort: () => ({
      limit: () => ({ lean: async () => [{
        _id: new Types.ObjectId(),
        storyId: story._id,
        viewerId: new Types.ObjectId(viewerId),
        viewedAt: new Date(),
      }] }),
    }),
  }));
  t.mock.method(UserModel, 'find', () => ({
    select: () => ({ lean: async () => [{
      _id: new Types.ObjectId(viewerId),
      username: 'viewer',
      displayName: 'Story Viewer',
      avatarUrl: null,
    }] }),
  }));

  const firstView = await request(app)
    .post(`/api/v1/stories/${mediaIds.story}/view`)
    .auth(viewerToken, { type: 'bearer' });
  const repeatView = await request(app)
    .post(`/api/v1/stories/${mediaIds.story}/view`)
    .auth(viewerToken, { type: 'bearer' });

  assert.equal(firstView.status, 200);
  assert.equal(firstView.body.viewCount, 1);
  assert.equal(repeatView.body.viewCount, 1);
  assert.equal(viewedIds.size, 1);

  const ownerViews = await request(app)
    .get(`/api/v1/stories/${mediaIds.story}/views`)
    .auth(ownerToken, { type: 'bearer' });
  const nonOwnerViews = await request(app)
    .get(`/api/v1/stories/${mediaIds.story}/views`)
    .auth(viewerToken, { type: 'bearer' });
  assert.equal(ownerViews.status, 200);
  assert.equal(ownerViews.body.viewers[0].username, 'viewer');
  assert.equal(nonOwnerViews.status, 404);
});

test('database publish failures remain server errors and do not expose internals', async (t) => {
  const { app, token } = createContentApp(t);
  t.mock.method(PostModel, 'create', async () => {
    throw new Error('database connection string must not be exposed');
  });
  t.mock.method(MediaModel, 'updateOne', async () => ({ modifiedCount: 1 }));
  const response = await request(app)
    .post('/api/v1/posts')
    .set('Authorization', `Bearer ${token}`)
    .send({ mediaId: mediaIds.post, caption: 'A real moment' });

  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Internal server error');
  assert.equal(JSON.stringify(response.body).includes('connection string'), false);
});
