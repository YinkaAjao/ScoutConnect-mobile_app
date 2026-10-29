// src/lib/scoutPlayer.ts
// Shapes the API returns to scouts (see scoutconnect-backend/lib/scouts.js), shared by Discover, Shortlist and the detail screen.
import { pillarScores, overallScore } from './ratings.ts';

export interface BodyMeasurements {
  heightCm?: number;
  weightKg?: number;
  dominantFoot?: 'Left' | 'Right' | 'Both';
  sprint10m?: number;
  bleepLevel?: number;
}

export interface Evaluation {
  id?: string;
  createdAt?: string;
  sprintSpeed: number;
  dribblingScore: number;
  workRate?: string;
  evalType: string;
  checklistData?: {
    averages?: {
      technical: number | null;
      tactical?: number | null;
      physical: number | null;
      psychological: number | null;
      scale?: number;
    };
    body?: BodyMeasurements; // measurements the coach recorded with this evaluation
  } | null;
}

export interface MatchStat {
  id: string;
  competition: string;
  opponent?: string;
  matchResult?: string;
  goals: number;
  assists: number;
  minutesPlayed: number;
}

export interface Achievement {
  id: string;
  title: string;
  year: number;
}

export interface ContactRequestState {
  id: string;
  status: 'Pending' | 'Accepted' | 'Declined';
  responseNote: string | null;
  canRequestAgainAt?: string | null;
}

export interface PlayerProspect {
  id: string;
  displayName: string; // first name + surname initial until the club accepts a contact request
  identityRevealed: boolean;
  position: string;
  age: number | null;
  profilePhoto?: string | null;
  Evaluations?: Evaluation[];
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
  Club?: {
    name: string;
    isVerified?: boolean;
    contactEmail?: string | null; // only present once the club has accepted
    contactPhone?: string | null;
  } | null;
  contactRequest?: ContactRequestState | null;
  shortlistId?: string | null; // set by the detail endpoint when this scout already shortlisted the athlete
}

/** Overall 0-100 rating from the newest evaluation, or null when nothing was rated (shown as N/A, never invented). */
export const latestOverall = (player: Pick<PlayerProspect, 'Evaluations'>): number | null => {
  const evaluations = player.Evaluations ?? [];
  if (evaluations.length === 0) return null;
  return overallScore(pillarScores(evaluations[evaluations.length - 1]));
};

export const positionAgeLine = (player: Pick<PlayerProspect, 'position' | 'age'>): string =>
  `${player.position || 'Position not set'}${player.age != null ? ` · ${player.age} yrs` : ''}`;

export interface MatchTotals {
  matches: number;
  goals: number;
  assists: number;
  minutes: number;
  goalsPer90: number | null; // null until there are minutes to divide by
  assistsPer90: number | null;
}

export const matchTotals = (matchStats: MatchStat[] | undefined): MatchTotals => {
  const list = matchStats ?? [];
  const goals = list.reduce((sum, m) => sum + (m.goals || 0), 0);
  const assists = list.reduce((sum, m) => sum + (m.assists || 0), 0);
  const minutes = list.reduce((sum, m) => sum + (m.minutesPlayed || 0), 0);
  const per90 = (count: number) => (minutes > 0 ? Math.round((count / minutes) * 90 * 100) / 100 : null);
  return { matches: list.length, goals, assists, minutes, goalsPer90: per90(goals), assistsPer90: per90(assists) };
};

/** Overall rating change between the first and the latest evaluation, or null with fewer than two rated evaluations. */
export const overallTrend = (player: Pick<PlayerProspect, 'Evaluations'>): number | null => {
  const rated = (player.Evaluations ?? [])
    .map((evaluation) => overallScore(pillarScores(evaluation)))
    .filter((value): value is number => value !== null);
  return rated.length >= 2 ? rated[rated.length - 1] - rated[0] : null;
};

/** Whole days since the newest evaluation, or null when there is none. */
export const daysSinceLastEvaluation = (player: Pick<PlayerProspect, 'Evaluations'>, now = new Date()): number | null => {
  const evaluations = player.Evaluations ?? [];
  const created = evaluations[evaluations.length - 1]?.createdAt;
  if (!created) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(created).getTime()) / 86_400_000));
};

/** A pillar score (0-1) as a rating out of 5 with one decimal, or null when not rated. */
export const outOfFive = (fraction: number | null): number | null => (fraction === null ? null : Math.round(fraction * 5 * 10) / 10);

/**
 * Height, weight and foot for the profile card. A coach may record them in only some evaluations, so each field
 * comes from the newest evaluation that has it.
 */
export const latestBody = (player: Pick<PlayerProspect, 'Evaluations'>): BodyMeasurements => {
  const body: BodyMeasurements = {};
  for (const evaluation of [...(player.Evaluations ?? [])].reverse()) {
    const recorded = evaluation.checklistData?.body;
    if (!recorded) continue;
    for (const key of Object.keys(recorded) as (keyof BodyMeasurements)[]) {
      if (body[key] === undefined && recorded[key] !== undefined) (body as Record<string, unknown>)[key] = recorded[key];
    }
  }
  return body;
};
