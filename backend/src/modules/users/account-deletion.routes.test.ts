import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import argon2 from 'argon2';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { createUserRouter } from './user.routes';

const userId = '0123456789abcdef01234567';
const jwtSecret = 'test-jwt-access-secret-at-least-32-chars-long';
const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
  JWT_ACCESS_SECRET: jwtSecret,
});

function buildApp(t: TestContext, deletionHandler: (id: string) => Promise<void>) {
  t.mock.method(UserModel, 'findOne', () => ({
    select: async () => ({ _id: userId }),
  }));
  t.mock.method(UserModel, 'findById', () => ({
    select: async () => ({ passwordHash: 'stored-hash' }),
  }));
  const app = express();
  app.use(express.json(), createUserRouter(config, undefined, deletionHandler));
  const token = jwt.sign(
    { sub: userId, tokenType: 'access' },
    jwtSecret,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '15m' },
  );
  return { app, token };
}

test('account deletion requires password confirmation and derives identity from authentication', async (t) => {
  const deletedIds: string[] = [];
  const deletionHandler = async (id: string) => { deletedIds.push(id); };
  const { app, token } = buildApp(t, deletionHandler);
  t.mock.method(argon2, 'verify', async () => true);

  const response = await request(app)
    .delete('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'current-password' });

  assert.equal(response.status, 204);
  assert.deepEqual(deletedIds, [userId]);
});

test('client-supplied account IDs are rejected', async (t) => {
  let deleted = false;
  const { app, token } = buildApp(t, async () => { deleted = true; });
  t.mock.method(argon2, 'verify', async () => true);

  const response = await request(app)
    .delete('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'current-password', userId: 'fedcbafedcbafedcbafedcba' });

  assert.equal(response.status, 400);
  assert.equal(deleted, false);
});

test('incorrect password confirmation does not trigger deletion', async (t) => {
  let deleted = false;
  const { app, token } = buildApp(t, async () => { deleted = true; });
  t.mock.method(argon2, 'verify', async () => false);

  const response = await request(app)
    .delete('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'wrong-password' });

  assert.equal(response.status, 401);
  assert.equal(deleted, false);
});

test('unauthenticated requests cannot delete accounts', async (t) => {
  let deleted = false;
  const { app } = buildApp(t, async () => { deleted = true; });

  const response = await request(app)
    .delete('/users/me')
    .send({ password: 'current-password' });

  assert.equal(response.status, 401);
  assert.equal(deleted, false);
});
