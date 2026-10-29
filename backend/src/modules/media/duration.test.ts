import assert from 'node:assert/strict';
import test from 'node:test';
import { isVerifiedDurationSeconds, normalizeDurationSeconds } from './duration';

test('normalizes millisecond metadata to seconds exactly once', () => {
  assert.equal(normalizeDurationSeconds(35_000, 'milliseconds'), 35);
  assert.equal(normalizeDurationSeconds(179_900, 'milliseconds'), 179.9);
});

test('preserves valid second-based metadata and rejects unavailable durations', () => {
  assert.equal(normalizeDurationSeconds(35, 'seconds'), 35);
  for (const duration of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
    assert.equal(normalizeDurationSeconds(duration, 'seconds'), null);
    assert.equal(isVerifiedDurationSeconds(duration), false);
  }
});
