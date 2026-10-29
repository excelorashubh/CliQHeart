import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { loadConfig } from '../../config/env';
import { createMessageRouter } from './message.routes';

test('message and conversation REST APIs require an access token', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    JWT_ACCESS_SECRET: 'test-jwt-access-secret-at-least-32-chars-long',
  });
  const app = express();
  app.use(express.json(), createMessageRouter(config));

  const responses = await Promise.all([
    request(app).get('/conversations'),
    request(app).post('/conversations/0123456789abcdef01234567/messages').send({ text: 'Hello' }),
    request(app).patch('/conversations/0123456789abcdef01234567/read'),
    request(app).get('/messages/unread-count'),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required.');
  }
});
