// src/lib/consent.ts
// Pure helper (no React Native imports) so it can be unit-tested with plain Node.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConsentFields {
  consentStatus?: string | null;
  consentGuardian?: string | null;
  consentGraceUntil?: string | null;
}

export type ConsentTone = 'ok' | 'warn' | 'bad';

export interface ConsentBadge {
  label: string;
  tone: ConsentTone;
  visibleToScouts: boolean;
}

/**
 * What a coach should see about an athlete's guardian consent. Mirrors the server rule: scouts see an athlete only
 * with consent recorded, or while the one-off grace period for older records is still running.
 */
export const consentBadge = (athlete: ConsentFields, now: number = Date.now()): ConsentBadge => {
  if (athlete.consentStatus === 'Recorded') return { label: 'Guardian consent recorded', tone: 'ok', visibleToScouts: true };

  const graceEnds = athlete.consentGraceUntil ? new Date(athlete.consentGraceUntil).getTime() : 0;
  if (graceEnds > now) {
    const days = Math.max(1, Math.ceil((graceEnds - now) / DAY_MS));
    return {
      label: `Consent needed · visible to scouts for ${days} more day${days === 1 ? '' : 's'}`,
      tone: 'warn',
      visibleToScouts: true,
    };
  }

  return { label: 'Hidden from scouts · consent needed', tone: 'bad', visibleToScouts: false };
};
