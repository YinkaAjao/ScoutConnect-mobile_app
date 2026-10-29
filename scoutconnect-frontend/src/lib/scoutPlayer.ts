// src/lib/scoutPlayer.ts
// Shapes the API returns to scouts (see scoutconnect-backend/lib/scouts.js), shared by Discover, Shortlist and the detail screen.
import { pillarScores, overallScore } from './ratings';

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
