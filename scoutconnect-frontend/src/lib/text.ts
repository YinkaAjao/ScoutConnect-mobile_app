// src/lib/text.ts
// Pure helpers (no React Native imports) so they can be unit-tested with plain Node.

/** Collapses runs of whitespace and trims, so "  Jean   Paul " and "Jean Paul" match. */
export const normaliseName = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

/** True only for real calendar dates written as YYYY-MM-DD. */
export const isValidDob = (value: unknown): boolean =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Device-generated id that lets the server recognise a record it has already stored. */
export const newClientId = (userId: string): string =>
  `${userId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export const timeAgo = (from: number, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
};

export const SKIP_REASONS: Record<string, string> = {
  athlete_removed: 'the athlete was removed from the roster',
  athlete_not_found: 'the athlete could not be found in the roster',
  invalid_athlete_details: 'the athlete name or date of birth is invalid',
  server_error: 'the server could not save it',
};

export const describeSkipReason = (reason: string): string => SKIP_REASONS[reason] ?? 'it was rejected';
