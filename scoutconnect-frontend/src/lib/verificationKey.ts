// src/lib/verificationKey.ts
// Pure helper (no React Native imports) so it can be unit-tested with plain Node.

const DECISIONS = ['Verified', 'Rejected', 'Revoked'];

/**
 * Identifies the newest admin decision in a club's history (newest first, as the server returns it),
 * or null if nobody has decided yet. Comparing this with the last key the owner saw tells us whether to show a badge.
 * The owner's own actions (Submitted, Reset) are deliberately ignored.
 */
export const decisionKey = (history?: { action: string; at: string }[] | null): string | null => {
  const latest = history?.find((event) => DECISIONS.includes(event.action));
  return latest ? `${latest.action}:${latest.at}` : null;
};
