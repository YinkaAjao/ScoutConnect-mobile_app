import test from 'node:test';
import assert from 'node:assert/strict';
import { pillarScores, overallScore } from './ratings.ts';

const checklist = (technical, tactical, physical) => ({ checklistData: { averages: { technical, tactical, physical, psychological: 3 } } });

test('checklist averages are out of 4', () => {
  assert.deepEqual(pillarScores(checklist(4, 2, 3)), { technical: 1, tactical: 0.5, physical: 0.75 });
});

test('without a checklist, technical falls back to the dribbling score (out of 5) and the rest stay unrated', () => {
  assert.deepEqual(pillarScores({ dribblingScore: 4 }), { technical: 0.8, tactical: null, physical: null });
});

test('nothing is invented for missing ratings', () => {
  assert.deepEqual(pillarScores({}), { technical: null, tactical: null, physical: null });
  assert.deepEqual(pillarScores({ dribblingScore: 0 }), { technical: null, tactical: null, physical: null });
  assert.equal(overallScore(pillarScores({})), null);
});

test('physical is never guessed from sprint time (a slower sprint must not score higher)', () => {
  const fast = pillarScores({ sprintSpeed: 4.0, dribblingScore: 3 });
  const slow = pillarScores({ sprintSpeed: 6.5, dribblingScore: 3 });
  assert.equal(fast.physical, null);
  assert.deepEqual(fast, slow);
});

test('the overall score averages only the pillars that were rated', () => {
  assert.equal(overallScore({ technical: 1, tactical: 0.5, physical: 0.75 }), 75);
  assert.equal(overallScore({ technical: 0.8, tactical: null, physical: null }), 80);
  assert.equal(overallScore({ technical: null, tactical: 0.5, physical: null }), 50);
});

test('values above the scale are capped at 1', () => {
  assert.equal(pillarScores({ dribblingScore: 9 }).technical, 1);
});
