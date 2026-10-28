// src/lib/ratings.ts
// Pure helpers (no React Native imports) so they can be unit-tested with plain Node.

export interface EvaluationLike {
  dribblingScore?: number | null;
  checklistData?: {
    averages?: {
      technical?: number | null;
      tactical?: number | null;
      physical?: number | null;
      psychological?: number | null;
    } | null;
  } | null;
}

export interface PillarScores {
  technical: number | null;
  tactical: number | null;
  physical: number | null;
}

/** value / outOf as a 0-1 fraction, or null when there is no real rating (so nothing is invented). */
const fraction = (value: number | null | undefined, outOf: number): number | null =>
  typeof value === 'number' && value > 0 ? Math.min(value / outOf, 1) : null;

/**
 * 0-1 score per pillar for an evaluation, or null for a pillar the coach never rated.
 * Checklist averages are out of 4; the stand-alone dribbling score is out of 5.
 * There is deliberately no estimate for "physical" without a checklist: sprint time alone can't be turned into a rating
 * without a calibrated scale, and a lower time is better, so dividing it would rank slower players higher.
 */
export const pillarScores = (evaluation: EvaluationLike): PillarScores => {
  const averages = evaluation.checklistData?.averages;
  return {
    technical: fraction(averages?.technical, 4) ?? fraction(evaluation.dribblingScore, 5),
    tactical: fraction(averages?.tactical, 4),
    physical: fraction(averages?.physical, 4),
  };
};

/** Average of the pillars that were actually rated, as 0-100, or null when none were. */
export const overallScore = (scores: PillarScores): number | null => {
  const rated = Object.values(scores).filter((value): value is number => value !== null);
  return rated.length ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 100) : null;
};
