import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, isValidDob, newClientId, timeAgo, describeSkipReason } from './text.ts';

test('normaliseName collapses whitespace and trims', () => {
  assert.equal(normaliseName('  Jean   Paul '), 'Jean Paul');
  assert.equal(normaliseName(undefined), '');
});

test('isValidDob accepts real dates only', () => {
  assert.equal(isValidDob('2008-02-29'), true);
  assert.equal(isValidDob('2009-02-29'), false);
  assert.equal(isValidDob('2008-1-5'), false);
  assert.equal(isValidDob(''), false);
});

test('newClientId is prefixed by the user and unique per call', () => {
  const a = newClientId('user-1');
  const b = newClientId('user-1');
  assert.ok(a.startsWith('user-1:'));
  assert.notEqual(a, b);
});

test('timeAgo buckets', () => {
  const now = 1_000_000_000;
  assert.equal(timeAgo(now - 10_000, now), 'just now');
  assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(timeAgo(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(timeAgo(now - 2 * 86_400_000, now), '2 d ago');
});

test('describeSkipReason falls back for unknown reasons', () => {
  assert.match(describeSkipReason('athlete_removed'), /removed/);
  assert.equal(describeSkipReason('???'), 'it was rejected');
});
