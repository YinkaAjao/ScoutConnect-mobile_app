import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportHtml, escapeHtml } from './report.ts';

const evaluation = (date, technical, physical, psychological) => ({
  evaluationDate: date,
  evaluatorName: 'Coach Secret',
  strengths: 'PRIVATE-STRENGTH',
  areasForImprovement: 'PRIVATE-WEAKNESS',
  checklistData: {
    averages: { technical, physical, psychological, scale: 5 },
    dominantFoot: 'Left', sprint30m: 4.2, heightCm: 178,
  },
});

const base = {
  name: 'Jean <b>Paul</b>',
  position: 'Midfielder',
  dateOfBirth: '2009-04-01',
  age: 16,
  clubName: 'Kigali Academy',
  evaluations: [evaluation('2026-01-10', 3, 3, 3), evaluation('2026-03-10', 4, 4, 5)],
  matchStats: [{ competition: 'League', goals: 2, assists: 1, minutesPlayed: 90 }],
  achievements: [{ title: 'Top scorer', year: 2025 }],
  generatedAt: new Date('2026-04-01T00:00:00Z'),
};

test('user-supplied text is escaped', () => {
  assert.equal(escapeHtml(`<script>"x"&'`), '&lt;script&gt;&quot;x&quot;&amp;&#39;');
  const html = buildReportHtml({ ...base, audience: 'coach' });
  assert.ok(!html.includes('<b>Paul</b>'));
  assert.ok(html.includes('Jean &lt;b&gt;Paul&lt;/b&gt;'));
});

test('a coach report leaves private notes out unless asked', () => {
  const without = buildReportHtml({ ...base, audience: 'coach' });
  assert.ok(!without.includes('PRIVATE-STRENGTH') && !without.includes('PRIVATE-WEAKNESS'));
  const withNotes = buildReportHtml({ ...base, audience: 'coach', includeNotes: true });
  assert.ok(withNotes.includes('PRIVATE-STRENGTH') && withNotes.includes('PRIVATE-WEAKNESS'));
});

test('a coach report shows biometrics, the evaluator and the date of birth', () => {
  const html = buildReportHtml({ ...base, audience: 'coach' });
  assert.ok(html.includes('Dominant foot: Left') && html.includes('30m sprint: 4.2s') && html.includes('Coach Secret'));
  assert.ok(html.includes('Born 2009-04-01'));
});

test('a scout report never contains notes, evaluator names, biometrics or the date of birth, even if notes are requested', () => {
  const html = buildReportHtml({ ...base, audience: 'scout', includeNotes: true });
  for (const secret of ['PRIVATE-STRENGTH', 'PRIVATE-WEAKNESS', 'Coach Secret', 'Dominant foot', '2009-04-01', 'Born']) {
    assert.ok(!html.includes(secret), `leaked: ${secret}`);
  }
  assert.ok(html.includes('16 yrs'));
});

test('the progress chart needs two complete evaluations', () => {
  assert.ok(buildReportHtml({ ...base, audience: 'coach' }).includes('<svg'));
  assert.ok(!buildReportHtml({ ...base, audience: 'coach', evaluations: [base.evaluations[0]] }).includes('<svg'));
});

test('a player with no evaluations still produces a report', () => {
  const html = buildReportHtml({ ...base, audience: 'coach', evaluations: [], matchStats: [], achievements: [] });
  assert.ok(html.includes('No evaluations have been logged yet'));
});

test('a scout report shows height and weight only when they were shared, and still never the coach-only biometrics', () => {
  const without = buildReportHtml({ ...base, audience: 'scout' });
  assert.ok(!without.includes('Height') && !without.includes('Weight'));

  const shared = buildReportHtml({ ...base, audience: 'scout', sharedBody: { heightCm: 181, weightKg: 70 } });
  assert.ok(shared.includes('Height: 181 cm') && shared.includes('Weight: 70 kg'));
  assert.ok(!shared.includes('Dominant foot') && !shared.includes('178'));
});
