// src/lib/age.ts
// Pure helper (no React Native imports) so it can be unit-tested with plain Node.

/** Whole years between a YYYY-MM-DD date of birth and `now`, or null if the date is missing or unusable. */
export const ageFromDob = (dob: string | null | undefined, now: Date = new Date()): number | null => {
  const [year, month, day] = String(dob ?? '').split('-').map(Number);
  if (!year || !month || !day) return null;
  let age = now.getFullYear() - year;
  const birthdayPassed = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
};
