import test from 'node:test';
import assert from 'node:assert/strict';
import { consentBadge } from './consent.ts';

const NOW = new Date('2026-10-29T12:00:00Z').getTime();

test('recorded consent is shown as fine and visible', () => {
  assert.deepEqual(consentBadge({ consentStatus: 'Recorded' }, NOW), { label: 'Guardian consent recorded', tone: 'ok', visibleToScouts: true });
});

test('a running grace period warns and counts the days left, rounding up', () => {
  const inThreeDays = new Date(NOW + 3 * 86400000 - 1000).toISOString();
  const badge = consentBadge({ consentStatus: null, consentGraceUntil: inThreeDays }, NOW);
  assert.equal(badge.tone, 'warn');
  assert.equal(badge.visibleToScouts, true);
  assert.match(badge.label, /3 more days/);

  const inAFewHours = new Date(NOW + 3 * 3600000).toISOString();
  assert.match(consentBadge({ consentGraceUntil: inAFewHours }, NOW).label, /1 more day$/);
});

test('an expired or missing grace period means hidden from scouts', () => {
  for (const athlete of [
    { consentStatus: null, consentGraceUntil: new Date(NOW - 1000).toISOString() },
    { consentStatus: 'Missing' },
    {},
  ]) {
    assert.deepEqual(consentBadge(athlete, NOW), { label: 'Hidden from scouts · consent needed', tone: 'bad', visibleToScouts: false });
  }
});

test('recorded consent wins over any leftover grace date', () => {
  const badge = consentBadge({ consentStatus: 'Recorded', consentGraceUntil: new Date(NOW + 86400000).toISOString() }, NOW);
  assert.equal(badge.tone, 'ok');
});
