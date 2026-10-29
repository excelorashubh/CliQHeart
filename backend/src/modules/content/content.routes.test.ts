import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Types } from 'mongoose';
import { loadConfig } from '../../config/env';
import { createApp } from '../../app';
import { UserModel } from '../../models/user';
import { MediaModel } from '../media/media.model';
import { PostModel } from './post.model';
import { ReelModel } from './reel.model';
import { StoryModel } from './story.model';
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
  ]);
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401]);
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
