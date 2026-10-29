import test from 'node:test';
import assert from 'node:assert/strict';
import { pillarScores, overallScore, averageRated, overallFromAverages, parseMeasure, progressPoints } from './ratings.ts';

const NONE = { technical: null, physical: null, coaching: null, tactical: null };
const checklist = (averages) => ({ checklistData: { averages } });

test('evaluations without a stored scale are legacy and out of 4', () => {
  assert.deepEqual(
    pillarScores(checklist({ technical: 4, tactical: 2, physical: 3, psychological: 3 })),
    { technical: 1, physical: 0.75, coaching: 0.75, tactical: 0.5 }
  );
});

test('current evaluations are out of the scale they were saved with (5)', () => {
  assert.deepEqual(
    pillarScores(checklist({ technical: 4, tactical: null, physical: 5, psychological: 2.5, scale: 5 })),
    { technical: 0.8, physical: 1, coaching: 0.5, tactical: null }
  );
});

test('without a checklist, technical falls back to the dribbling score (out of 5) and the rest stay unrated', () => {
  assert.deepEqual(pillarScores({ dribblingScore: 4 }), { ...NONE, technical: 0.8 });
});

test('nothing is invented for missing ratings', () => {
  assert.deepEqual(pillarScores({}), NONE);
  assert.deepEqual(pillarScores({ dribblingScore: 0 }), NONE);
  assert.equal(overallScore(pillarScores({})), null);
});

test('physical is never guessed from sprint time (a slower sprint must not score higher)', () => {
  const fast = pillarScores({ sprintSpeed: 4.0, dribblingScore: 3 });
  const slow = pillarScores({ sprintSpeed: 6.5, dribblingScore: 3 });
  assert.equal(fast.physical, null);
  assert.deepEqual(fast, slow);
});

test('the overall score averages only the pillars that were rated', () => {
  assert.equal(overallScore({ technical: 1, physical: 0.75, coaching: 0.5, tactical: null }), 75);
  assert.equal(overallScore({ ...NONE, technical: 0.8 }), 80);
  assert.equal(overallScore({ ...NONE, coaching: 0.5 }), 50);
});

test('values above the scale are capped at 1', () => {
  assert.equal(pillarScores({ dribblingScore: 9 }).technical, 1);
});

test('averageRated ignores unrated (0) attributes and returns null when nothing is rated', () => {
  assert.equal(averageRated({ a: 5, b: 4, c: 0 }), 4.5);
  assert.equal(averageRated({ a: 0, b: 0 }), null);
});

test('overallFromAverages averages the categories that exist', () => {
  assert.equal(overallFromAverages([4, null, 3]), 3.5);
  assert.equal(overallFromAverages([null, null]), null);
});

test('progressPoints puts every category on 1-5, rescaling legacy evaluations and skipping incomplete ones', () => {
  const legacy = checklist({ technical: 4, physical: 2, psychological: 3 }); // out of 4
  const current = checklist({ technical: 4, physical: 5, psychological: 2.5, scale: 5 });
  const incomplete = { dribblingScore: 4 }; // no physical or coaching rating
  const points = progressPoints([legacy, incomplete, current]);
  assert.equal(points.length, 2);
  assert.deepEqual(points.map(({ technical, physical, coaching }) => ({ technical, physical, coaching })), [
    { technical: 5, physical: 2.5, coaching: 3.75 },
    { technical: 4, physical: 5, coaching: 2.5 },
  ]);
  assert.equal(points[1].source, current);
});

test('parseMeasure: empty is optional, bad or out-of-range is NaN, comma decimals are accepted', () => {
  assert.equal(parseMeasure('', 1, 10), null);
  assert.equal(parseMeasure(' 3,85 ', 1, 10), 3.85);
  assert.ok(Number.isNaN(parseMeasure('abc', 1, 10)));
  assert.ok(Number.isNaN(parseMeasure('0.5', 1, 10)));
  assert.ok(Number.isNaN(parseMeasure('11', 1, 10)));
});
