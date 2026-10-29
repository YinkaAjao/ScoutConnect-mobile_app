// src/lib/report.ts
// Builds the HTML of a player report (printed to PDF by lib/reportExport.ts). Pure: no React Native imports, so it can be unit-tested.
import { RATING_SCALE, overallScore, pillarScores, progressPoints } from './ratings.ts';

export interface ReportEvaluation {
  createdAt?: string;
  evaluationDate?: string;
  evaluatorName?: string;
  sprintSpeed?: number | null;
  dribblingScore?: number | null;
  overallRating?: number | null;
  strengths?: string | null;
  areasForImprovement?: string | null;
  checklistData?: {
    averages?: {
      technical?: number | null;
      tactical?: number | null;
      physical?: number | null;
      psychological?: number | null;
      scale?: number | null;
    } | null;
    evaluationDate?: string;
    evaluatorName?: string;
    strengths?: string;
    areasForImprovement?: string;
    dominantFoot?: string;
    sprint10m?: number | null;
    sprint30m?: number | null;
    bleepLevel?: number | null;
    heightCm?: number | null;
    weightKg?: number | null;
  } | null;
}

export interface ReportMatchStat {
  competition: string;
  opponent?: string | null;
  matchResult?: string | null;
  matchDate?: string | null;
  goals?: number | null;
  assists?: number | null;
  minutesPlayed?: number | null;
}

export interface ReportInput {
  /** A scout's report only ever contains what a scout may see: no coach names, notes or biometrics (height and weight only when `sharedBody` is passed). */
  audience: 'coach' | 'scout';
  name: string;
  position?: string | null;
  dateOfBirth?: string | null;
  age?: number | null;
  clubName?: string | null;
  clubVerified?: boolean;
  evaluations: ReportEvaluation[];
  matchStats: ReportMatchStat[];
  achievements: { title: string; year?: number | null }[];
  /** Height and weight for a scout's report. Pass them only once the club has accepted that scout's contact request. */
  sharedBody?: { heightCm?: number | null; weightKg?: number | null };
  /** The coach's private notes (strengths, areas for improvement). Ignored for scouts. */
  includeNotes?: boolean;
  generatedAt?: Date;
}

const COLORS = { technical: '#2E8B57', physical: '#2563EB', coaching: '#D97706' };

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const one = (value: number | null | undefined) => (typeof value === 'number' ? (Math.round(value * 10) / 10).toFixed(1) : '–');

const evaluationDate = (e: ReportEvaluation) =>
  e.evaluationDate || e.checklistData?.evaluationDate || e.createdAt?.slice(0, 10) || '';

/** Category scores and overall for one evaluation on the 1-5 scale (legacy 1-4 evaluations rescaled), null when unrated. */
const scoresOf = (e: ReportEvaluation) => {
  const s = pillarScores(e);
  const on5 = (f: number | null) => (f === null ? null : f * RATING_SCALE);
  const overall = overallScore(s);
  return { technical: on5(s.technical), physical: on5(s.physical), coaching: on5(s.coaching), overall: overall === null ? null : overall / 20 };
};

const progressChartSvg = (evaluations: ReportEvaluation[]): string => {
  const points = progressPoints(evaluations);
  if (points.length < 2) return '';
  const W = 640, H = 240, left = 34, right = 14, top = 12, bottom = 46;
  const x = (i: number) => left + (i * (W - left - right)) / (points.length - 1);
  const y = (v: number) => top + ((RATING_SCALE - v) * (H - top - bottom)) / (RATING_SCALE - 1);

  const grid = [1, 2, 3, 4, 5]
    .map((v) => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="#E5E7EB"/><text x="${left - 8}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6B7280">${v}</text>`)
    .join('');
  const series = (['technical', 'physical', 'coaching'] as const)
    .map((key) => {
      const line = points.map((p, i) => `${x(i)},${y(p[key])}`).join(' ');
      const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key])}" r="3.5" fill="${COLORS[key]}"/>`).join('');
      return `<polyline points="${line}" fill="none" stroke="${COLORS[key]}" stroke-width="2.5"/>${dots}`;
    })
    .join('');
  const step = points.length > 8 ? 2 : 1; // thin the date labels out when there are many evaluations
  const labels = points
    .map((p, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - bottom + 16}" font-size="10" text-anchor="middle" fill="#6B7280">${escapeHtml(evaluationDate(p.source).slice(5).replace('-', '/'))}</text>` : ''))
    .join('');
  const legend = (['technical', 'physical', 'coaching'] as const)
    .map((key, i) => `<rect x="${left + i * 110}" y="${H - 14}" width="12" height="4" fill="${COLORS[key]}"/><text x="${left + i * 110 + 18}" y="${H - 8}" font-size="11" fill="#374151">${key[0].toUpperCase()}${key.slice(1)}</text>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${grid}${series}${labels}${legend}</svg>`;
};

const CSS = `
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 0; padding: 28px; font-size: 13px; }
  h1 { font-size: 22px; margin: 0; } h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #2E8B57; }
  .muted { color: #6B7280; } .row { display: flex; gap: 10px; } .card { flex: 1; border: 1px solid #E5E7EB; border-radius: 8px; padding: 10px; text-align: center; }
  .card b { display: block; font-size: 20px; margin-top: 2px; } .label { font-size: 10px; letter-spacing: .5px; color: #6B7280; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #E5E7EB; }
  th { font-size: 11px; color: #6B7280; } .note { background: #F9FAFB; border-left: 3px solid #2E8B57; padding: 8px 10px; margin: 6px 0; }
  .badge { display: inline-block; font-size: 10px; background: #D1FAE5; color: #047857; border-radius: 4px; padding: 2px 6px; margin-left: 6px; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #E5E7EB; font-size: 10px; color: #6B7280; }
`;

export const buildReportHtml = (input: ReportInput): string => {
  const isCoach = input.audience === 'coach';
  const withNotes = isCoach && Boolean(input.includeNotes);
  const evaluations = input.evaluations;
  const latest = evaluations[evaluations.length - 1];
  const latestScores = latest ? scoresOf(latest) : null;
  const generated = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);

  const meta = [
    input.position,
    isCoach ? (input.dateOfBirth ? `Born ${input.dateOfBirth}` : null) : input.age != null ? `${input.age} yrs` : null,
    input.clubName,
  ].filter(Boolean).map(escapeHtml).join(' · ');

  const bio = latest?.checklistData;
  const sharedBody = !isCoach ? input.sharedBody : undefined;
  const biometrics = !isCoach
    ? [
        sharedBody?.heightCm && `Height: ${sharedBody.heightCm} cm`,
        sharedBody?.weightKg && `Weight: ${sharedBody.weightKg} kg`,
      ].filter(Boolean)
    : bio
    ? [
        bio.dominantFoot && `Dominant foot: ${bio.dominantFoot}`,
        bio.sprint10m && `10m sprint: ${bio.sprint10m}s`,
        bio.sprint30m && `30m sprint: ${bio.sprint30m}s`,
        bio.bleepLevel && `Bleep test: level ${bio.bleepLevel}`,
        bio.heightCm && `Height: ${bio.heightCm} cm`,
        bio.weightKg && `Weight: ${bio.weightKg} kg`,
      ].filter(Boolean)
    : [];

  const snapshot = latestScores
    ? `<h2>Latest evaluation${evaluationDate(latest) ? ` · ${escapeHtml(evaluationDate(latest))}` : ''}</h2>
       <div class="row">
         <div class="card"><span class="label">TECHNICAL</span><b>${one(latestScores.technical)}</b></div>
         <div class="card"><span class="label">PHYSICAL</span><b>${one(latestScores.physical)}</b></div>
         <div class="card"><span class="label">COACHING</span><b>${one(latestScores.coaching)}</b></div>
         <div class="card"><span class="label">OVERALL</span><b>${one(latestScores.overall)}</b></div>
       </div>
       <p class="muted">Ratings are out of ${RATING_SCALE}.</p>
       ${biometrics.length ? `<p>${biometrics.map(escapeHtml).join(' &nbsp;•&nbsp; ')}</p>` : ''}`
    : `<h2>Evaluations</h2><p class="muted">No evaluations have been logged yet.</p>`;

  const chart = progressChartSvg(evaluations);

  const history = evaluations.length
    ? `<h2>Evaluation history</h2><table><tr><th>Date</th><th>Technical</th><th>Physical</th><th>Coaching</th><th>Overall</th>${isCoach ? '<th>Evaluator</th>' : ''}</tr>
       ${[...evaluations].reverse().map((e) => {
         const s = scoresOf(e);
         const strengths = e.strengths || e.checklistData?.strengths;
         const improve = e.areasForImprovement || e.checklistData?.areasForImprovement;
         const notes = withNotes && (strengths || improve)
           ? `<tr><td colspan="6"><div class="note">${strengths ? `<b>Strengths:</b> ${escapeHtml(strengths)}` : ''}${strengths && improve ? '<br/>' : ''}${improve ? `<b>To improve:</b> ${escapeHtml(improve)}` : ''}</div></td></tr>`
           : '';
         return `<tr><td>${escapeHtml(evaluationDate(e) || '–')}</td><td>${one(s.technical)}</td><td>${one(s.physical)}</td><td>${one(s.coaching)}</td><td>${one(s.overall)}</td>${isCoach ? `<td>${escapeHtml(e.evaluatorName || e.checklistData?.evaluatorName || '–')}</td>` : ''}</tr>${notes}`;
       }).join('')}</table>`
    : '';

  const matches = input.matchStats.length
    ? `<h2>Match history</h2><table><tr><th>Date</th><th>Competition</th><th>Opponent</th><th>Result</th><th>G</th><th>A</th><th>Min</th></tr>
       ${input.matchStats.map((m) => `<tr><td>${escapeHtml(m.matchDate || '–')}</td><td>${escapeHtml(m.competition)}</td><td>${escapeHtml(m.opponent || '–')}</td><td>${escapeHtml(m.matchResult || '–')}</td><td>${m.goals ?? 0}</td><td>${m.assists ?? 0}</td><td>${m.minutesPlayed ?? '–'}</td></tr>`).join('')}</table>`
    : '';

  const achievements = input.achievements.length
    ? `<h2>Achievements</h2><ul>${input.achievements.map((a) => `<li>${escapeHtml(a.title)}${a.year ? ` (${escapeHtml(a.year)})` : ''}</li>`).join('')}</ul>`
    : '';

  const footer = isCoach
    ? `Generated ${generated} from ScoutConnect. ${withNotes ? 'This report includes the coach\'s private notes. ' : ''}Contains personal information about a player: share responsibly.`
    : `Generated ${generated} from ScoutConnect for an accredited scout. Contains personal information about a young player and is shared with the consent of their guardian. Do not republish or forward beyond people who need it for scouting.`;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(input.name)} – ScoutConnect report</title><style>${CSS}</style></head><body>
    <div class="muted" style="font-size:11px;letter-spacing:1px">SCOUTCONNECT · PLAYER REPORT</div>
    <h1>${escapeHtml(input.name)}${input.clubVerified ? '<span class="badge">Verified club</span>' : ''}</h1>
    <div class="muted">${meta}</div>
    ${snapshot}
    ${chart ? `<h2>Progress over time</h2>${chart}` : ''}
    ${history}${matches}${achievements}
    <div class="footer">${footer}</div>
  </body></html>`;
};
