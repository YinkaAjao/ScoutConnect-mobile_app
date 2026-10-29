import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, serverQuery, passesClientFilters, needsClientFilter, activeChips } from './discoverFilters.ts';

const NOW = new Date('2026-10-29T12:00:00Z');
const player = (overrides = {}) => ({
  id: 'p1',
  displayName: 'Jean M.',
  position: 'Striker / Center Forward',
  age: 16,
  Evaluations: [{ createdAt: '2026-10-20T00:00:00Z', sprintSpeed: 4.6, dribblingScore: 4, evalType: 'Checklist', checklistData: { averages: { technical: 4, physical: 4, psychological: 4, scale: 5 } } }],
  MatchStats: [{ id: 'm1', competition: 'League', goals: 1, assists: 0, minutesPlayed: 90 }],
  ...overrides,
});
const filters = (overrides = {}) => ({ ...DEFAULT_FILTERS, ...overrides });

test('default filters send nothing to the server and keep every evaluated athlete', () => {
  assert.equal(serverQuery(DEFAULT_FILTERS, ''), '');
  assert.equal(needsClientFilter(DEFAULT_FILTERS), false);
  assert.equal(passesClientFilters(player(), DEFAULT_FILTERS, NOW), true);
  assert.deepEqual(activeChips(DEFAULT_FILTERS), []);
});

test('athletes without an evaluation are never shown', () => {
  assert.equal(passesClientFilters(player({ Evaluations: [] }), DEFAULT_FILTERS, NOW), false);
});

test('age bands and sorting become server parameters', () => {
  assert.equal(serverQuery(filters({ ageBand: '15-16', sort: 'youngest', verifiedOnly: true }), 'jean'), 'search=jean&verifiedOnly=true&minAge=15&under=17&sort=youngest');
  assert.equal(serverQuery(filters({ ageBand: 'u13' }), ''), 'under=13');
  assert.equal(serverQuery(filters({ ageBand: '19+' }), ''), 'minAge=19');
});

test('rating and test filters run on the latest evaluation', () => {
  assert.equal(passesClientFilters(player(), filters({ minOverall: 80 }), NOW), true); // 4/5 = 80
  assert.equal(passesClientFilters(player(), filters({ minOverall: 90 }), NOW), false);
  assert.equal(passesClientFilters(player(), filters({ minBallControl: 5 }), NOW), false);
  assert.equal(passesClientFilters(player(), filters({ maxSprint: 4.7 }), NOW), true);
  assert.equal(passesClientFilters(player(), filters({ maxSprint: 4.4 }), NOW), false);
});

test('a missing sprint time does not pass a sprint filter', () => {
  const noSprint = player({ Evaluations: [{ ...player().Evaluations[0], sprintSpeed: null }] });
  assert.equal(passesClientFilters(noSprint, filters({ maxSprint: 5 }), NOW), false);
});

test('recency and match-stat filters', () => {
  assert.equal(passesClientFilters(player(), filters({ evaluatedWithinDays: 30 }), NOW), true);
  const old = player({ Evaluations: [{ ...player().Evaluations[0], createdAt: '2026-01-01T00:00:00Z' }] });
  assert.equal(passesClientFilters(old, filters({ evaluatedWithinDays: 90 }), NOW), false);
  assert.equal(passesClientFilters(player({ MatchStats: [] }), filters({ hasMatches: true }), NOW), false);
});

test('every active filter has a chip that clears just that filter', () => {
  const chips = activeChips(filters({ position: 'Defender', minOverall: 60, hasMatches: true }));
  assert.deepEqual(chips.map((c) => c.key), ['position', 'minOverall', 'hasMatches']);
  assert.deepEqual(chips[1].reset, { minOverall: 0 });
});
