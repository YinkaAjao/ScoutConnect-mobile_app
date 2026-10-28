import test from 'node:test';
import assert from 'node:assert/strict';
import { positionQueryFor, POSITION_CATEGORIES } from '../constants/positions.ts';

const decode = (query) => {
  const [key, value] = query.split('=');
  return { key, values: decodeURIComponent(value).split(',') };
};

test('"All" adds no filter', () => {
  assert.equal(positionQueryFor('All'), '');
});

test('a category matches its own name and every specific position in it', () => {
  const { key, values } = decode(positionQueryFor('Defender'));
  assert.equal(key, 'positions');
  assert.ok(values.includes('Defender'));
  assert.ok(values.includes('Center Back'));
  assert.ok(values.includes('Right Wingback'));
  assert.ok(!values.includes('Goalkeeper'));
});

test('positions containing slashes and spaces survive encoding', () => {
  const query = positionQueryFor('Forward');
  assert.ok(!query.includes(' ') && !query.includes('/'));
  assert.ok(decode(query).values.includes('Striker / Center Forward'));
});

test('"Other" excludes every known category and position', () => {
  const { key, values } = decode(positionQueryFor('Other'));
  assert.equal(key, 'excludePositions');
  for (const [category, list] of Object.entries(POSITION_CATEGORIES)) {
    assert.ok(values.includes(category), category);
    for (const position of list) assert.ok(values.includes(position), position);
  }
});

test('an unknown choice adds no filter instead of an empty result', () => {
  assert.equal(positionQueryFor('Wizard'), '');
});
