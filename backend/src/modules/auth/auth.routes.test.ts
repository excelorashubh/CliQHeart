import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { createApp } from '../../app';
import { registerSchema, loginSchema } from './auth.validation';

const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
});

test('register validation requires password matching and agreement terms', () => {
  assert.throws(() => registerSchema.parse({
    displayName: 'Test User',
    username: 'test_user',
    email: 'test@example.com',
    password: 'Password123!',
    confirmPassword: 'WrongPass123!',
    agreeToTerms: true,
  }));

  assert.throws(() => registerSchema.parse({
    displayName: 'Test User',
    username: 'test_user',
    email: 'test@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    agreeToTerms: false,
  }));
});

test('login validation requires identifier and password', () => {
  const result = loginSchema.parse({
    identifier: 'test@example.com',
    password: 'Password123!',
  });

  assert.equal(result.identifier, 'test@example.com');
  assert.equal(result.password, 'Password123!');
});

test('registration validation normalizes identifiers and rejects reserved usernames', () => {
  const result = registerSchema.parse({
    displayName: 'Test User',
    username: ' Test_User ',
    email: ' TEST@example.com ',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    agreeToTerms: true,
  });

  assert.equal(result.username, 'test_user');
  assert.equal(result.email, 'test@example.com');
  assert.throws(() => registerSchema.parse({
    displayName: 'Administrator',
    username: 'admin',
    email: 'admin@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    agreeToTerms: true,
  }));
});

test('register route returns structured validation errors without accessing the database', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      displayName: 'Test User',
      username: 'admin',
      email: 'not-an-email',
      password: 'weak',
      confirmPassword: 'different',
      agreeToTerms: false,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Invalid registration data.');
  assert.ok(Array.isArray(response.body.details));
  assert.ok(response.body.details.some((issue: { field: string }) => issue.field === 'username'));
  assert.ok(response.body.details.some((issue: { field: string }) => issue.field === 'email'));
  assert.ok(response.headers['x-request-id']);
});

test('login route rejects a missing identifier before accessing the database', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: '', password: 'Password123!' });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: 'Invalid login request.',
  });
});

test('browser cookie auth rejects untrusted origins and never returns refresh tokens in JSON', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const rejected = await request(app)
    .post('/api/v1/auth/refresh')
    .set('Origin', 'https://untrusted.example')
    .set('X-Session-Transport', 'cookie');
  const missingSession = await request(app)
    .post('/api/v1/auth/refresh')
    .set('Origin', 'http://localhost:5173')
    .set('X-Session-Transport', 'cookie');

  assert.equal(rejected.status, 403);
  assert.equal(missingSession.status, 401);
  assert.equal(missingSession.body.refreshToken, undefined);
});

test('browser logout clears the HttpOnly cookie and native logout stays idempotent', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const browserLogout = await request(app)
    .post('/api/v1/auth/logout')
    .set('Origin', 'http://localhost:5173')
    .set('X-Session-Transport', 'cookie');
  const nativeLogout = await request(app).post('/api/v1/auth/logout').send({});
  const clearedCookie = browserLogout.headers['set-cookie']?.[0] ?? '';

  assert.equal(browserLogout.status, 204);
  assert.ok(clearedCookie.includes('HttpOnly'));
  assert.ok(clearedCookie.includes('cliqheart_refresh=;'));
  assert.equal(nativeLogout.status, 204);
});
