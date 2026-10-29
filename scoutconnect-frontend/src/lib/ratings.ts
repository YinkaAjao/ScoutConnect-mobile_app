// src/lib/ratings.ts
// Pure helpers (no React Native imports) so they can be unit-tested with plain Node.

/** Every rated attribute is scored 1-5. Evaluations saved before the change were scored 1-4 and carry no `scale`. */
export const RATING_SCALE = 5;
const LEGACY_SCALE = 4;

export interface EvaluationLike {
  dribblingScore?: number | null;
  checklistData?: {
    averages?: {
      technical?: number | null;
      tactical?: number | null;
      physical?: number | null;
      psychological?: number | null;
      scale?: number | null;
    } | null;
  } | null;
}

export interface PillarScores {
  technical: number | null;
  physical: number | null;
  coaching: number | null;
  /** Only present on legacy evaluations; the current form no longer rates tactical attributes. */
  tactical: number | null;
}

/** value / outOf as a 0-1 fraction, or null when there is no real rating (so nothing is invented). */
const fraction = (value: number | null | undefined, outOf: number): number | null =>
  typeof value === 'number' && value > 0 ? Math.min(value / outOf, 1) : null;

/** Mean of the attributes the coach actually rated (0 = not rated), rounded to 2 decimals, or null when none were. */
export const averageRated = (ratings: Record<string, number>): number | null => {
  const rated = Object.values(ratings).filter((value) => value > 0);
  return rated.length ? parseFloat((rated.reduce((sum, value) => sum + value, 0) / rated.length).toFixed(2)) : null;
};

/** Overall 1-5 rating: the mean of the category averages that exist. */
export const overallFromAverages = (averages: (number | null)[]): number | null => {
  const present = averages.filter((value): value is number => value !== null);
  return present.length ? parseFloat((present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(2)) : null;
};

/** Parses a typed measurement ("3,85" or "3.85"). Empty is null (optional); a bad or out-of-range value is NaN. */
export const parseMeasure = (text: string, min: number, max: number): number | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= min && value <= max ? value : NaN;
};

/**
 * 0-1 score per pillar for an evaluation, or null for a pillar the coach never rated.
 * Checklist averages use the scale stored with them (1-4 for legacy evaluations); the stand-alone dribbling score is out of 5.
 * There is deliberately no estimate for "physical" without a checklist: sprint time alone can't be turned into a rating
 * without a calibrated scale, and a lower time is better, so dividing it would rank slower players higher.
 */
export const pillarScores = (evaluation: EvaluationLike): PillarScores => {
  const averages = evaluation.checklistData?.averages;
  const scale = averages?.scale ?? LEGACY_SCALE;
  return {
    technical: fraction(averages?.technical, scale) ?? fraction(evaluation.dribblingScore, 5),
    physical: fraction(averages?.physical, scale),
    coaching: fraction(averages?.psychological, scale),
    tactical: fraction(averages?.tactical, scale),
  };
};

export interface ProgressPoint<T> {
  source: T;
  technical: number;
  physical: number;
  coaching: number;
}

/**
 * One point per evaluation for a progress chart, every category on the same 1-5 scale (legacy 1-4 evaluations are rescaled).
 * Evaluations missing any of the three categories are left out rather than drawn as a drop to zero or guessed.
 */
export const progressPoints = <T extends EvaluationLike>(evaluations: T[]): ProgressPoint<T>[] =>
  evaluations.flatMap((source) => {
    const { technical, physical, coaching } = pillarScores(source);
    if (technical === null || physical === null || coaching === null) return [];
    const onScale = (fractionValue: number) => parseFloat((fractionValue * RATING_SCALE).toFixed(2));
    return [{ source, technical: onScale(technical), physical: onScale(physical), coaching: onScale(coaching) }];
  });

/** Average of the pillars that were actually rated, as 0-100, or null when none were. */
export const overallScore = (scores: PillarScores): number | null => {
  const rated = Object.values(scores).filter((value): value is number => value !== null);
  return rated.length ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 100) : null;
};
