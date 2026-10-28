import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionKey } from './verificationKey.ts';

test('no history or no decisions means nothing to show', () => {
  assert.equal(decisionKey(undefined), null);
  assert.equal(decisionKey(null), null);
  assert.equal(decisionKey([]), null);
  assert.equal(decisionKey([{ action: 'Submitted', at: '2026-10-01T10:00:00Z' }]), null);
});

test('the newest admin decision is used, ignoring the owner\'s own actions', () => {
  const history = [
    { action: 'Submitted', at: '2026-10-05T10:00:00Z' },
    { action: 'Rejected', at: '2026-10-04T10:00:00Z' },
    { action: 'Submitted', at: '2026-10-01T10:00:00Z' },
  ];
  assert.equal(decisionKey(history), 'Rejected:2026-10-04T10:00:00Z');
});

test('a new decision produces a different key, so the badge returns', () => {
  const before = decisionKey([{ action: 'Rejected', at: '2026-10-04T10:00:00Z' }]);
  const after = decisionKey([
    { action: 'Verified', at: '2026-10-09T10:00:00Z' },
    { action: 'Rejected', at: '2026-10-04T10:00:00Z' },
  ]);
  assert.notEqual(before, after);
});

test('Reset (caused by the owner renaming the club) does not count as a decision', () => {
  assert.equal(decisionKey([{ action: 'Reset', at: '2026-10-09T10:00:00Z' }]), null);
});
