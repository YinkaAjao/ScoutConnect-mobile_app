import test from 'node:test';
import assert from 'node:assert/strict';
import { ageFromDob } from './age.ts';

const NOW = new Date(2026, 9, 29); // 29 October 2026

test('age counts whole years and only ticks over on the birthday', () => {
  assert.equal(ageFromDob('2010-10-29', NOW), 16); // birthday today
  assert.equal(ageFromDob('2010-10-30', NOW), 15); // birthday tomorrow
  assert.equal(ageFromDob('2010-01-01', NOW), 16);
  assert.equal(ageFromDob('2010-12-31', NOW), 15);
});

test('missing, malformed or future dates give no age', () => {
  for (const bad of [null, undefined, '', 'not-a-date', '2030-01-01']) assert.equal(ageFromDob(bad, NOW), null);
});
