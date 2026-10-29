// src/lib/discoverFilters.ts
// The scout's Discover filters. Pure (no React Native imports) so it can be unit-tested with plain Node.
import { positionQueryFor } from '../constants/positions.ts';
import { daysSinceLastEvaluation, latestOverall, matchTotals } from './scoutPlayer.ts';
import type { PlayerProspect } from './scoutPlayer.ts';

export type SortKey = 'name' | 'youngest' | 'oldest';

export interface DiscoverFilters {
  // Applied by the server, so they work across every page of athletes.
  position: string;           // 'All', a category such as 'Defender', or 'Other'
  evalSource: string;         // 'All', 'Checklist', 'Combine', 'Match'
  ageBand: string;            // key of AGE_BANDS
  verifiedOnly: boolean;
  sort: SortKey;
  // Applied on the phone to the athletes already loaded (the app keeps loading pages until some match).
  minOverall: number;         // 0 = any; OVR is 0-100
  minBallControl: number;     // 0 = any; 1-5
  maxSprint: number | null;   // seconds over 30m; null = any
  evaluatedWithinDays: number | null;
  hasMatches: boolean;
}

export const AGE_BANDS: { key: string; label: string; minAge?: number; under?: number }[] = [
  { key: 'any', label: 'Any age' },
  { key: 'u13', label: 'U13', under: 13 },
  { key: '13-14', label: '13-14', minAge: 13, under: 15 },
  { key: '15-16', label: '15-16', minAge: 15, under: 17 },
  { key: '17-18', label: '17-18', minAge: 17, under: 19 },
  { key: '19+', label: '19+', minAge: 19 },
];

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name A-Z' },
  { key: 'youngest', label: 'Youngest first' },
  { key: 'oldest', label: 'Oldest first' },
];

export const OVERALL_STEPS = [0, 50, 60, 70, 80];
export const BALL_CONTROL_STEPS = [0, 3, 4, 5];
export const SPRINT_STEPS: (number | null)[] = [null, 5, 4.7, 4.4];
export const RECENCY_STEPS: (number | null)[] = [null, 30, 90, 180];

export const DEFAULT_FILTERS: DiscoverFilters = {
  position: 'All',
  evalSource: 'All',
  ageBand: 'any',
  verifiedOnly: false,
  sort: 'name',
  minOverall: 0,
  minBallControl: 0,
  maxSprint: null,
  evaluatedWithinDays: null,
  hasMatches: false,
};

/** The server-side part of the filters as a query string (without page and limit). */
export const serverQuery = (filters: DiscoverFilters, search: string): string => {
  const parts: string[] = [];
  if (search) parts.push(`search=${encodeURIComponent(search)}`);
  const position = positionQueryFor(filters.position);
  if (position) parts.push(position);
  if (filters.evalSource !== 'All') parts.push(`evalType=${encodeURIComponent(filters.evalSource)}`);
  if (filters.verifiedOnly) parts.push('verifiedOnly=true');
  const band = AGE_BANDS.find((candidate) => candidate.key === filters.ageBand);
  if (band?.minAge) parts.push(`minAge=${band.minAge}`);
  if (band?.under) parts.push(`under=${band.under}`);
  if (filters.sort !== 'name') parts.push(`sort=${filters.sort}`);
  return parts.join('&');
};

/** The phone-side part: does this athlete pass the rating, test and activity filters? Athletes without an evaluation never do. */
export const passesClientFilters = (player: PlayerProspect, filters: DiscoverFilters, now = new Date()): boolean => {
  const evaluations = player.Evaluations ?? [];
  if (evaluations.length === 0) return false;
  const latest = evaluations[evaluations.length - 1];

  if (filters.minOverall > 0 && (latestOverall(player) ?? -1) < filters.minOverall) return false;
  if (filters.minBallControl > 0 && (latest.dribblingScore || 0) < filters.minBallControl) return false;
  // A missing sprint time can't be shown to be fast enough, so it fails the filter.
  if (filters.maxSprint !== null && !(latest.sprintSpeed > 0 && latest.sprintSpeed <= filters.maxSprint)) return false;
  if (filters.evaluatedWithinDays !== null) {
    const days = daysSinceLastEvaluation(player, now);
    if (days === null || days > filters.evaluatedWithinDays) return false;
  }
  if (filters.hasMatches && matchTotals(player.MatchStats).matches === 0) return false;
  return true;
};

export const needsClientFilter = (filters: DiscoverFilters): boolean =>
  filters.minOverall > 0 || filters.minBallControl > 0 || filters.maxSprint !== null || filters.evaluatedWithinDays !== null || filters.hasMatches;

export interface FilterChip {
  key: string;
  label: string;
  reset: Partial<DiscoverFilters>;
}

/** One removable chip per active filter (sorting is not a filter, so it never appears here). */
export const activeChips = (filters: DiscoverFilters): FilterChip[] => {
  const chips: FilterChip[] = [];
  if (filters.position !== 'All') chips.push({ key: 'position', label: filters.position, reset: { position: 'All' } });
  if (filters.evalSource !== 'All') chips.push({ key: 'evalSource', label: `${filters.evalSource} evals`, reset: { evalSource: 'All' } });
  if (filters.ageBand !== 'any') chips.push({ key: 'ageBand', label: AGE_BANDS.find((b) => b.key === filters.ageBand)?.label ?? filters.ageBand, reset: { ageBand: 'any' } });
  if (filters.verifiedOnly) chips.push({ key: 'verifiedOnly', label: 'Verified clubs', reset: { verifiedOnly: false } });
  if (filters.minOverall > 0) chips.push({ key: 'minOverall', label: `OVR ${filters.minOverall}+`, reset: { minOverall: 0 } });
  if (filters.minBallControl > 0) chips.push({ key: 'minBallControl', label: `Ball control ${filters.minBallControl}+`, reset: { minBallControl: 0 } });
  if (filters.maxSprint !== null) chips.push({ key: 'maxSprint', label: `30m ≤ ${filters.maxSprint}s`, reset: { maxSprint: null } });
  if (filters.evaluatedWithinDays !== null) chips.push({ key: 'evaluatedWithinDays', label: `Evaluated in ${filters.evaluatedWithinDays}d`, reset: { evaluatedWithinDays: null } });
  if (filters.hasMatches) chips.push({ key: 'hasMatches', label: 'Has match stats', reset: { hasMatches: false } });
  return chips;
};
