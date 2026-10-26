import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabase, isDatabaseConnected } from './mongoose';

test('database lifecycle reports disconnected and closes idempotently without Atlas', async () => {
  assert.equal(isDatabaseConnected(), false);
  await closeDatabase();
  await closeDatabase();
  assert.equal(isDatabaseConnected(), false);
});
