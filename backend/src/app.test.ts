import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { loadConfig } from './config/env';
import { createApp, type RequestLogEntry } from './app';

const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
});

test('health endpoint returns the stable response and 503 when the database is disconnected', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 503);
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
    status: 'unavailable',
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
});

test('CORS allows only configured origins', async () => {
  const app = createApp({ config, databaseStatus: () => false });
  const response = await request(app)
    .get('/api/v1')
    .set('Origin', 'http://localhost:3000');

  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
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
