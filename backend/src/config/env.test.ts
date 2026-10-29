import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './env';

const baseEnvironment = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
};

test('loads application, database, CORS, token lifetime, and logging configuration', () => {
  const config = loadConfig({
    ...baseEnvironment,
    HOST: '127.0.0.1',
    PORT: '4010',
    APP_NAME: 'CliQHeart API',
    APP_VERSION: '2.3.4',
    MONGODB_DB_NAME: 'cliqheart_test',
    ANDROID_DEV_ORIGIN: 'http://192.168.1.20:4000',
    CORS_ORIGINS: 'https://example.test,https://admin.example.test',
    LOG_LEVEL: 'debug',
    ACCESS_TOKEN_TTL: '20m',
    REFRESH_TOKEN_TTL: '14d',
  });

  assert.equal(config.NODE_ENV, 'test');
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.PORT, 4010);
  assert.equal(config.APP_NAME, 'CliQHeart API');
  assert.equal(config.APP_VERSION, '2.3.4');
  assert.equal(config.MONGODB_DB_NAME, 'cliqheart_test');
  assert.equal(config.ANDROID_DEV_ORIGIN, 'http://192.168.1.20:4000');
  assert.equal(config.FRONTEND_URL, 'https://cliqhearts.onrender.com');
  assert.deepEqual(config.CORS_ORIGINS, [
    'https://example.test',
    'https://admin.example.test',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://cliqhearts.onrender.com',
  ]);
  assert.equal(config.LOG_LEVEL, 'debug');
  assert.equal(config.ACCESS_TOKEN_TTL, '20m');
  assert.equal(config.REFRESH_TOKEN_TTL, '14d');
  assert.equal(config.JWT_ACCESS_SECRET, undefined);
  assert.equal(config.JWT_REFRESH_SECRET, undefined);
});

test('uses safe defaults for optional configuration', () => {
  const config = loadConfig(baseEnvironment);

  assert.equal(config.HOST, '0.0.0.0');
  assert.equal(config.PORT, 4000);
  assert.equal(config.APP_NAME, 'CliQHeart');
  assert.equal(config.MONGODB_DB_NAME, 'cliqheart');
  assert.deepEqual(config.CORS_ORIGINS, [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://cliqhearts.onrender.com',
  ]);
  assert.equal(config.LOG_LEVEL, 'info');
});

test('uses the requested frontend and allowed-origins environment variables', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    FRONTEND_URL: 'https://cliqhearts.onrender.com',
    ALLOWED_ORIGINS:
      'https://cliqhearts.onrender.com,http://localhost:5173,http://127.0.0.1:5173',
  });

  assert.equal(config.FRONTEND_URL, 'https://cliqhearts.onrender.com');
  assert.deepEqual(config.CORS_ORIGINS, [
    'https://cliqhearts.onrender.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
});

test('retains the legacy CORS_ORIGINS environment variable', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
    CORS_ORIGINS: 'https://legacy.example',
  });

  assert.ok(config.CORS_ORIGINS.includes('https://legacy.example'));
  assert.ok(config.CORS_ORIGINS.includes('https://cliqhearts.onrender.com'));
});

test('requires MongoDB URI without exposing credentials', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test' }),
    /MONGODB_URI: MONGODB_URI is required/,
  );
});

test('rejects malformed configuration and short or reused auth secrets', () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnvironment,
        PORT: '70000',
        LOG_LEVEL: 'verbose',
        JWT_ACCESS_SECRET: 'too-short',
      }),
    /Invalid environment configuration/,
  );

  const reusedSecret = 'distinct-secrets-should-not-be-reused-123';
  assert.throws(
    () =>
      loadConfig({
        ...baseEnvironment,
        JWT_ACCESS_SECRET: reusedSecret,
        JWT_REFRESH_SECRET: reusedSecret,
      }),
    /JWT access and refresh secrets must be different/,
  );
});

test('accepts distinct adequately sized optional authentication secrets', () => {
  const config = loadConfig({
    ...baseEnvironment,
    JWT_ACCESS_SECRET: 'access-placeholder-value-long-enough-123',
    JWT_REFRESH_SECRET: 'refresh-placeholder-value-long-enough-456',
  });

  assert.equal(config.JWT_ACCESS_SECRET, 'access-placeholder-value-long-enough-123');
  assert.equal(config.JWT_REFRESH_SECRET, 'refresh-placeholder-value-long-enough-456');
});

test('rejects invalid CORS origins and token lifetimes', () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnvironment,
        CORS_ORIGINS: 'https://example.test/path',
        ACCESS_TOKEN_TTL: 'tomorrow',
      }),
    /Invalid environment configuration/,
  );
});
