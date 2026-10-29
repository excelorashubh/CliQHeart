import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { CloudinaryUnavailableError, createCloudinaryClient } from './cloudinary';
import { MediaModel } from './media.model';
import { createMediaRouter, uploadRules } from './media.routes';

test('media schema tracks owner, upload verification, attachment, and lifecycle state', () => {
  const media = new MediaModel({
    ownerId: '507f1f77bcf86cd799439011',
    purpose: 'post',
    resourceType: 'image',
    publicId: 'cliqheart/post/507f1f77bcf86cd799439011/test',
    folder: 'cliqheart/post/507f1f77bcf86cd799439011',
    signatureExpiresAt: new Date(Date.now() + 60_000),
    status: 'deleting',
  });

  assert.equal(media.validateSync(), undefined);
  assert.equal(media.status, 'deleting');
  assert.ok(MediaModel.schema.path('attachedTo'));
  assert.ok(MediaModel.schema.path('signatureExpiresAt'));
});

test('upload rules constrain file purposes, resource types, formats, and maximum sizes', () => {
  assert.deepEqual(uploadRules.profile.resourceTypes, ['image']);
  assert.equal(uploadRules.profile.maxBytes, 5 * 1024 * 1024);
  assert.deepEqual(uploadRules.post.resourceTypes, ['image', 'video']);
  assert.equal(uploadRules.post.maxBytes, 100 * 1024 * 1024);
  assert.deepEqual(uploadRules.story.resourceTypes, ['image', 'video']);
  assert.deepEqual(uploadRules.reel.resourceTypes, ['video']);
  assert.equal(uploadRules.reel.maxBytes, 250 * 1024 * 1024);
  const reelFormats: readonly string[] = uploadRules.reel.formats;
  assert.ok(!reelFormats.includes('png'));
});

test('Cloudinary stays unavailable without a backend API key and secret', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
  });

  assert.throws(() => createCloudinaryClient(config), CloudinaryUnavailableError);
});

test('profile signatures are authenticated, scoped to the profile folder, and sign the uploaded parameters', async (t) => {
  const accessSecret = 'test-jwt-access-secret-at-least-32-chars-long';
  const apiSecret = 'test-cloudinary-api-secret-never-returned';
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    JWT_ACCESS_SECRET: accessSecret,
    CLOUDINARY_CLOUD_NAME: 'dapomdxat',
    CLOUDINARY_API_KEY: 'test-cloudinary-api-key',
    CLOUDINARY_API_SECRET: apiSecret,
  });
  const ownerId = '0123456789abcdef01234567';
  const mediaId = 'abcdefabcdefabcdefabcdef';
  const timestampBeforeRequest = Math.floor(Date.now() / 1000);
  const sign = t.mock.fn((parameters: Record<string, string | number | boolean>) => {
    const publicId = parameters.public_id;
    assert.equal(typeof publicId, 'string');
    if (typeof publicId !== 'string') throw new Error('Public ID was not signed as a string.');
    assert.deepEqual(parameters, {
      allowed_formats: 'jpg,jpeg,png,webp',
      overwrite: false,
      public_id: `cliqheart/profiles/${ownerId}/${publicId.split('/').pop()}`,
      timestamp: parameters.timestamp,
    });
    assert.equal(typeof parameters.timestamp, 'number');
    assert.ok(Number.isInteger(parameters.timestamp));
    return 'test-signature';
  });
  const provider = {
    sign,
    resource: async () => ({}),
    destroy: async () => ({ result: 'ok' }),
  };
  t.mock.method(UserModel, 'findOne', () => ({
    select: async () => ({ _id: ownerId }),
  }));
  t.mock.method(MediaModel, 'create', async (media: Record<string, unknown>) => {
    assert.equal(media.ownerId, ownerId);
    assert.equal(media.purpose, 'profile');
    assert.equal(media.resourceType, 'image');
    assert.match(String(media.publicId), new RegExp(`^cliqheart/profiles/${ownerId}/`));
    return { _id: mediaId, status: 'uploading' };
  });

  const app = express();
  app.use(express.json(), createMediaRouter(config, provider));
  const token = jwt.sign({ sub: ownerId, tokenType: 'access' }, accessSecret, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    expiresIn: '15m',
  });
  const unauthorized = await request(app)
    .post('/media/signature')
    .send({ purpose: 'profile', resourceType: 'image' });
  const response = await request(app)
    .post('/media/signature')
    .set('Authorization', `Bearer ${token}`)
    .send({ purpose: 'profile', resourceType: 'image' });

  assert.equal(unauthorized.status, 401);
  assert.equal(response.status, 201);
  assert.equal(sign.mock.calls.length, 1);
  assert.equal(response.body.upload.apiKey, 'test-cloudinary-api-key');
  assert.equal(response.body.upload.cloudName, 'dapomdxat');
  assert.equal(response.body.upload.resourceType, 'image');
  assert.equal(response.body.upload.maxBytes, 5 * 1024 * 1024);
  assert.ok(response.body.upload.timestamp >= timestampBeforeRequest);
  assert.ok(response.body.upload.timestamp <= Math.floor(Date.now() / 1000));
  assert.match(response.body.upload.uploadUrl, /dapomdxat\/image\/upload$/);
  assert.ok(!JSON.stringify(response.body).includes(apiSecret));
});
