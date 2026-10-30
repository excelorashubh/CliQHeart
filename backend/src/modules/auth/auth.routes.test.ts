import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { createApp } from '../../app';
import { registerSchema, loginSchema } from './auth.validation';
import { UserModel } from '../../models/user';

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

test('username availability validates input and returns only availability status', async (t) => {
  const app = createApp({ config, databaseStatus: () => false });
  t.mock.method(UserModel, 'exists', async (filter: { username: string }) =>
    filter.username === 'existing_user' ? { _id: 'private-id' } : null,
  );

  const available = await request(app)
    .get('/api/v1/auth/username-availability?username=New_User')
    .set('Origin', 'http://localhost:5173');
  const taken = await request(app)
    .get('/api/v1/auth/username-availability?username=Existing_User')
    .set('Origin', 'https://cliqhearts.onrender.com');
  const invalid = await request(app)
    .get('/api/v1/auth/username-availability?username=bad%20name')
    .set('Origin', 'http://127.0.0.1:5173');

  assert.equal(available.status, 200);
  assert.deepEqual(available.body, { available: true, message: 'Username available' });
  assert.equal(taken.status, 200);
  assert.deepEqual(taken.body, { available: false, message: 'Username already exists' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, { available: false, message: 'Username format is invalid' });
});

test('allowed origins can preflight registration without authentication', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  for (const origin of [
    'https://cliqhearts.onrender.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]) {
    const response = await request(app)
      .options('/api/v1/auth/register')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization,x-csrf-token');

    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.match(response.headers['access-control-allow-methods'] ?? '', /POST/);
    const allowedHeaders = response.headers['access-control-allow-headers'] ?? '';
    assert.match(allowedHeaders, /content-type/i);
    assert.match(allowedHeaders, /authorization/i);
    assert.match(allowedHeaders, /x-csrf-token/i);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
  }
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

test('login returns service unavailable immediately while the database is disconnected', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'person@example.com', password: 'Password123!' });

  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'Authentication is temporarily unavailable.');
  assert.equal(response.body.requestId, response.headers['x-request-id']);
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
  const loopbackMissingSession = await request(app)
    .post('/api/v1/auth/refresh')
    .set('Origin', 'http://127.0.0.1:5173')
    .set('X-Session-Transport', 'cookie');

  assert.equal(rejected.status, 403);
  assert.equal(missingSession.status, 401);
  assert.equal(loopbackMissingSession.status, 401);
  assert.equal(missingSession.body.refreshToken, undefined);
});

test('refresh limiter does not count browser session checks when no cookie exists', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const responses = await Promise.all(
    Array.from({ length: 35 }, () => request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('X-Session-Transport', 'cookie')),
  );

  assert.ok(responses.every((response) => response.status === 401));
  assert.ok(responses.every((response) => response.body.error === 'Refresh session is unavailable.'));
  assert.ok(responses.every((response) => response.headers.ratelimit === undefined));
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
  assert.ok(clearedCookie.includes('Secure'));
  assert.ok(clearedCookie.includes('SameSite=None'));
  assert.ok(clearedCookie.includes('cliqheart_refresh=;'));
  assert.ok(clearedCookie.includes('Path=/api/v1/auth'));
  assert.equal(nativeLogout.status, 204);
});
