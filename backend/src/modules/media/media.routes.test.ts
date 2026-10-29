import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../../config/env';
import { CloudinaryUnavailableError, createCloudinaryClient } from './cloudinary';
import { MediaModel } from './media.model';
import { uploadRules } from './media.routes';

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
  assert.equal(uploadRules.profile.maxBytes, 10 * 1024 * 1024);
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
