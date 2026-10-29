import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { loadConfig } from './config/env';
import { createApp, type RequestLogEntry } from './app';

const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
});

test('health endpoint remains available and reports database disconnection separately', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    'application',
    'database',
    'environment',
    'status',
    'timestamp',
    'version',
  ]);
  assert.deepEqual(response.body, {
    application: 'CliQHeart',
    status: 'ok',
    timestamp: response.body.timestamp,
    environment: 'test',
    database: 'disconnected',
    version: '0.1.0',
  });
  assert.equal(Number.isNaN(Date.parse(response.body.timestamp)), false);
});

test('health endpoint reports healthy status when the database is connected', async () => {
  const app = createApp({ config, databaseStatus: () => true });
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, 'connected');
});

test('versioned API root returns application metadata', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app).get('/api/v1');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    application: 'CliQHeart',
    apiVersion: 'v1',
    documentation: 'docs/API.md',
    status: 'ok',
    version: '0.1.0',
  });
});

test('post and Reel detail endpoints remain protected by access-token authentication', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const postResponse = await request(app).get('/api/v1/posts/507f1f77bcf86cd799439011');
  const reelResponse = await request(app).get('/api/v1/reels/507f1f77bcf86cd799439011');

  assert.equal(postResponse.status, 401);
  assert.equal(reelResponse.status, 401);
  assert.deepEqual(postResponse.body, { error: 'Authentication required.' });
  assert.deepEqual(reelResponse.body, { error: 'Authentication required.' });
});

test('saved, tagged, and notification endpoints require authenticated access', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const responses = await Promise.all([
    request(app).get('/api/v1/users/me/saved'),
    request(app).get('/api/v1/users/507f1f77bcf86cd799439011/tagged'),
    request(app).post('/api/v1/posts/507f1f77bcf86cd799439011/save'),
    request(app).post('/api/v1/posts/507f1f77bcf86cd799439011/tags').send({ userId: '507f1f77bcf86cd799439012' }),
    request(app).delete('/api/v1/posts/507f1f77bcf86cd799439011/tags/me'),
    request(app).get('/api/v1/notifications'),
    request(app).get('/api/v1/notifications/unread-count'),
    request(app).patch('/api/v1/notifications/read-all'),
    request(app).patch('/api/v1/notifications/507f1f77bcf86cd799439011/read'),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [
    401, 401, 401, 401, 401, 401, 401, 401, 401,
  ]);
});

test('malformed JSON returns a safe 400 response', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .post('/api/v1/example')
    .set('Content-Type', 'application/json')
    .send('{"broken":');

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Malformed JSON request');
  assert.ok(response.body.requestId);
});

test('unknown routes return a generic not-found response', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app).get('/missing');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    error: 'Not found',
    requestId: response.body.requestId,
  });
});

test('security middleware sets headers and restricts CORS origin', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .get('/api/v1')
    .set('Origin', 'https://untrusted.example');

  assert.equal(response.headers['x-powered-by'], undefined);
  assert.ok(response.headers['x-content-type-options']);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'Browser origin is not allowed.');
});

test('CORS allows the production frontend origin', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .get('/api/v1')
    .set('Origin', 'https://cliqhearts.onrender.com');

  assert.equal(response.headers['access-control-allow-origin'], 'https://cliqhearts.onrender.com');
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
});

test('default CORS configuration allows the Vite development origin', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .get('/api/v1')
    .set('Origin', 'http://localhost:5173');

  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('CORS preflights allow browser auth headers before auth routes', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  for (const [origin, path] of [
    ['https://cliqhearts.onrender.com', '/api/v1/auth/login'],
    ['http://localhost:5173', '/api/v1/auth/login'],
    ['http://127.0.0.1:5173', '/api/v1/auth/refresh'],
  ] as const) {
    const response = await request(app)
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'content-type,authorization,x-csrf-token,x-session-transport',
      );

    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.match(response.headers['access-control-allow-methods'] ?? '', /POST/);
    assert.match(response.headers['access-control-allow-headers'] ?? '', /content-type/i);
    assert.match(response.headers['access-control-allow-headers'] ?? '', /authorization/i);
    assert.match(response.headers['access-control-allow-headers'] ?? '', /x-csrf-token/i);
    assert.match(response.headers['access-control-allow-headers'] ?? '', /x-session-transport/i);
  }
});

test('unapproved browser origins are rejected before routes', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .options('/api/v1/auth/login')
    .set('Origin', 'https://untrusted.example')
    .set('Access-Control-Request-Method', 'POST');

  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'Browser origin is not allowed.');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('approved origins receive CORS headers on request errors', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .post('/api/v1/example')
    .set('Origin', 'http://localhost:5173')
    .set('Content-Type', 'application/json')
    .send('{"broken":');

  assert.equal(response.status, 400);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('private user and message routes require a valid access token', async () => {
  const app = createApp({ config, databaseStatus: () => false });

  const profileResponse = await request(app).get('/api/v1/users/me');
  const conversationResponse = await request(app).get('/api/v1/conversations');

  assert.equal(profileResponse.status, 401);
  assert.deepEqual(profileResponse.body, { error: 'Authentication required.' });
  assert.equal(conversationResponse.status, 401);
  assert.deepEqual(conversationResponse.body, { error: 'Authentication required.' });

  const publicProfileResponse = await request(app).get('/api/v1/users/0123456789abcdef01234567');
  const followersResponse = await request(app)
    .get('/api/v1/users/0123456789abcdef01234567/followers');
  assert.equal(publicProfileResponse.status, 401);
  assert.equal(followersResponse.status, 401);
});

test('media and content routes require access tokens while their preflights remain public', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const protectedResponses = await Promise.all([
    request(app).post('/api/v1/media/signature').send({ purpose: 'post', resourceType: 'image' }),
    request(app).get('/api/v1/posts'),
    request(app).get('/api/v1/stories'),
    request(app).get('/api/v1/reels'),
  ]);
  for (const response of protectedResponses) {
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Authentication required.' });
  }

  for (const path of ['/api/v1/media/signature', '/api/v1/posts', '/api/v1/stories', '/api/v1/reels']) {
    const response = await request(app)
      .options(path)
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', path.endsWith('signature') ? 'POST' : 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
  }
});

test('request ID is returned and logs omit raw URL, query, and credentials', async () => {
  const entries: RequestLogEntry[] = [];
  const app = createApp({
    config,
    databaseStatus: () => false,
    requestLogger: (entry) => entries.push(entry),
  });
  const response = await request(app).get('/api/v1?token=private-value');

  const responseId = response.headers['x-request-id'];
  assert.ok(responseId);
  assert.match(responseId ?? '', /^[0-9a-f-]{36}$/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.requestId, responseId);
  assert.equal(entries[0]?.route, 'GET /api/v1');
  assert.equal(JSON.stringify(entries).includes('private-value'), false);
});
