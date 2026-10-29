import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { createProfessionalRouter } from './professional.routes';

const userId = '0123456789abcdef01234567';
const accessSecret = 'test-jwt-access-secret-at-least-32-chars-long';

function createTestApp(t: TestContext) {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    JWT_ACCESS_SECRET: accessSecret,
  });
  t.mock.method(UserModel, 'findOne', () => ({
    select: async () => ({ _id: userId }),
  }));
  const findUserById = t.mock.method(UserModel, 'findById', () => {
    throw new Error('Invalid onboarding input must be rejected before loading an account.');
  });
  const app = express();
  app.use(express.json(), createProfessionalRouter(config));
  const token = jwt.sign(
    { sub: userId, tokenType: 'access' },
    accessSecret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );
  return { app, token, findUserById };
}

function createExistingUserApp(t: TestContext) {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    JWT_ACCESS_SECRET: accessSecret,
  });
  const user = new UserModel({
    _id: userId,
    username: 'existing_user',
    displayName: 'Existing User',
    accountStatus: 'active',
  });
  t.mock.method(UserModel, 'findOne', () => ({
    select: async () => ({ _id: userId }),
  }));
  t.mock.method(UserModel, 'findById', () => ({
    select: () => Promise.resolve(user),
  }));
  t.mock.method(user, 'save', async () => user);

  const app = express();
  app.use(express.json(), createProfessionalRouter(config));
  const token = jwt.sign(
    { sub: userId, tokenType: 'access' },
    accessSecret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );
  return { app, token, user };
}

test('professional endpoints require an authenticated account', async (t) => {
  const { app } = createTestApp(t);

  const response = await request(app).get('/professional/me');

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Authentication required.');
});

for (const accountType of ['CREATOR', 'BUSINESS'] as const) {
  test(`onboarding converts the existing user to ${accountType} without replacing identity`, async (t) => {
    const { app, token, user } = createExistingUserApp(t);
    const send = (method: 'patch' | 'post', path: string, body: object) =>
      request(app)[method](path).set('Authorization', `Bearer ${token}`).send(body);

    const typeResponse = await send('patch', '/professional/onboarding', {
      step: 'type',
      accountType,
    });
    assert.equal(typeResponse.status, 200);
    assert.equal(typeResponse.body.professional.accountType, 'PERSONAL');
    assert.equal(typeResponse.body.professional.onboardingDraft.accountType, accountType);

    const categoryResponse = await send('patch', '/professional/onboarding', {
      step: 'category',
      category: 'ARTIST',
    });
    assert.equal(categoryResponse.status, 200);

    const confirmationResponse = await send('patch', '/professional/onboarding', {
      step: 'confirmation',
      confirmPublicProfile: true,
    });
    assert.equal(confirmationResponse.status, 200);

    const conversionResponse = await send('post', '/professional/convert', {
      confirmPublicProfile: true,
    });

    assert.equal(conversionResponse.status, 200);
    assert.equal(conversionResponse.body.professional.accountType, accountType);
    assert.equal(conversionResponse.body.professional.category, 'ARTIST');
    assert.equal(String(user._id), userId);
    assert.equal(user.username, 'existing_user');
    assert.equal(user.displayName, 'Existing User');
    assert.equal(user.accountType, accountType);
    assert.equal(user.professionalOnboardingDraft, undefined);

    const repeatedConversion = await send('post', '/professional/convert', {
      confirmPublicProfile: true,
    });
    assert.equal(repeatedConversion.status, 200);
    assert.equal(repeatedConversion.body.professional.accountType, accountType);
    assert.equal(user.username, 'existing_user');
  });
}

test('onboarding rejects client-supplied account IDs instead of targeting another account', async (t) => {
  const { app, token, findUserById } = createTestApp(t);

  const response = await request(app)
    .patch('/professional/onboarding')
    .set('Authorization', `Bearer ${token}`)
    .send({ step: 'type', accountType: 'CREATOR', userId: 'fedcbafedcbafedcbafedcba' });

  assert.equal(response.status, 400);
  assert.equal(findUserById.mock.calls.length, 0);
});
