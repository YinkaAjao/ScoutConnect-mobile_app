// lib/scouts.js
// Rules for what a scout may see, and how scouts apply. Pure functions (plus Sequelize operators), so they are unit-testable.
const { Op } = require('sequelize');
const { normaliseName } = require('./profile');
const { validateSubmission } = require('./verification');

const ORG_TYPES = ['Club recruiter', 'Independent scout', 'Agent', 'Academy', 'Federation / league', 'Other'];
const CONSENT_GRACE_DAYS = 3;
const CONTACT_COOLDOWN_DAYS = 30; // after a club declines, the same scout must wait before asking again about that athlete
const ACCESS_LOG_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Jean Paul Mugisha" -> "Jean M."; a single name stays as it is. Used until the club releases the full identity. */
function publicName(name) {
  const parts = normaliseName(name).split(' ').filter(Boolean);
  if (parts.length === 0) return 'Athlete';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Whole years between a YYYY-MM-DD date of birth and `now`, or null if the date is unusable. */
function ageFromDob(dob, now = new Date()) {
  const [year, month, day] = String(dob || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  let age = now.getUTCFullYear() - year;
  const birthdayPassed = now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * The date such that anyone born AFTER it is younger than `years` today (so "under 15" = dateOfBirth > cutoff).
 * A 29 February that does not exist in the target year becomes the 28th.
 */
function dobCutoffForUnder(years, now = new Date()) {
  const year = now.getUTCFullYear() - years;
  const month = now.getUTCMonth() + 1;
  let day = now.getUTCDate();
  if (new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) day = 28;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Scouts see an athlete only with a guardian's consent on record (or while the grace period for older records runs),
 * and never while an administrator has hidden them, for example after a serious report.
 */
function isVisibleToScouts(player, now = new Date()) {
  if (player.scoutHidden) return false;
  if (player.consentStatus === 'Recorded') return true;
  return Boolean(player.consentGraceUntil) && new Date(player.consentGraceUntil) > now;
}

/** The same rule as a database condition. */
const visibleToScoutsWhere = (now = new Date()) => ({
  [Op.and]: [
    { [Op.or]: [{ consentStatus: 'Recorded' }, { consentGraceUntil: { [Op.gt]: now } }] },
    { [Op.or]: [{ scoutHidden: false }, { scoutHidden: null }] }
  ]
});

/** When a scout may ask again after a decline, or null if they may ask now. */
function contactCooldownEnds(request, now = new Date()) {
  if (request?.status !== 'Declined' || !request.respondedAt) return null;
  const ends = new Date(new Date(request.respondedAt).getTime() + CONTACT_COOLDOWN_DAYS * DAY_MS);
  return ends > now ? ends : null;
}

// Plausible ranges, the same as the coach's evaluation form; anything outside is treated as not recorded.
const BODY_RANGES = { heightCm: [100, 230], weightKg: [20, 150], sprint10m: [1, 4], bleepLevel: [1, 25] };
const FEET = ['Left', 'Right', 'Both'];

// Body size of a young person is withheld, like their surname, until the club accepts that scout's contact request.
const REVEALED_ONLY = ['heightCm', 'weightKg'];

/**
 * The physical measurements a coach recorded with an evaluation (dominant foot, 10m sprint, bleep level, and height and
 * weight once `revealed`), or null if there are none. Picked field by field, so the coach's notes and names stored
 * beside them never leak.
 */
function scoutBody(checklistData, revealed = false) {
  if (!checklistData || typeof checklistData !== 'object') return null;
  const body = {};
  for (const [key, [min, max]] of Object.entries(BODY_RANGES)) {
    if (REVEALED_ONLY.includes(key) && !revealed) continue;
    const value = Number(checklistData[key]);
    if (Number.isFinite(value) && value >= min && value <= max) body[key] = value;
  }
  if (FEET.includes(checklistData.dominantFoot)) body.dominantFoot = checklistData.dominantFoot;
  return Object.keys(body).length ? body : null;
}

const byCreatedAt = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

/**
 * The only shape in which a scout receives an athlete. Fields are listed explicitly, so new database columns can
 * never leak by accident. Date of birth becomes an age; the surname and the club's contact details are withheld
 * until the club accepts that scout's contact request.
 */
function toScoutAthlete(row, { now = new Date(), request = null, photoUrl = null } = {}) {
  const player = typeof row.toJSON === 'function' ? row.toJSON() : row;
  const revealed = request?.status === 'Accepted';

  let club = null;
  if (player.Club) {
    club = {
      name: player.Club.name,
      isVerified: Boolean(player.Club.isVerified),
      standingStatus: player.Club.standingStatus ?? null,
      trustScore: player.Club.trustScore ?? null
    };
    if (revealed) {
      club.contactEmail = player.Club.contactEmail || null;
      club.contactPhone = player.Club.contactPhone || null;
    }
  }

  return {
    id: player.id,
    displayName: revealed ? normaliseName(player.name) : publicName(player.name),
    identityRevealed: revealed,
    position: player.position,
    age: ageFromDob(player.dateOfBirth, now),
    profilePhoto: photoUrl || null, // a short-lived signed link; the stored file path is never exposed
    Evaluations: [...(player.Evaluations || [])].sort(byCreatedAt).map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      evalType: e.evalType,
      sprintSpeed: e.sprintSpeed,
      dribblingScore: e.dribblingScore,
      overallRating: e.overallRating,
      // Only the numeric averages and body measurements; the coach's free-text notes and names stay private.
      checklistData: e.checklistData?.averages || scoutBody(e.checklistData, revealed)
        ? { ...(e.checklistData?.averages ? { averages: e.checklistData.averages } : {}), ...(scoutBody(e.checklistData, revealed) ? { body: scoutBody(e.checklistData, revealed) } : {}) }
        : null
    })),
    MatchStats: (player.MatchStats || []).map((m) => ({
      id: m.id, competition: m.competition, opponent: m.opponent, matchResult: m.matchResult,
      matchDate: m.matchDate, goals: m.goals, assists: m.assists, minutesPlayed: m.minutesPlayed
    })),
    Achievements: (player.Achievements || []).map((a) => ({ id: a.id, title: a.title, year: a.year })),
    Club: club,
    contactRequest: request
      ? {
          id: request.id,
          status: request.status,
          responseNote: request.status === 'Pending' ? null : request.responseNote || null,
          canRequestAgainAt: contactCooldownEnds(request, now)?.toISOString() ?? null
        }
      : null
  };
}

/** Validates a scout's accreditation application. Returns { error } or the cleaned fields plus documents. */
function validateAccreditation(body, userId) {
  const organisation = normaliseName(body?.organisation);
  if (!organisation) return { error: 'Enter the organisation you scout for, or "Independent".' };
  if (organisation.length > 120) return { error: 'The organisation name must be 120 characters or fewer.' };
  if (!ORG_TYPES.includes(body?.orgType)) return { error: 'Choose what kind of scout you are.' };

  const docs = validateSubmission({ statement: body?.statement, documents: body?.documents }, userId);
  if (docs.error) return docs;

  return {
    organisation,
    orgType: body.orgType,
    licenceNumber: normaliseName(body?.licenceNumber).slice(0, 60) || null,
    statement: docs.statement,
    documents: docs.documents
  };
}

/**
 * One-time cover for athletes that existed before consent was required: they stay visible for a few days so coaches
 * can record consent. Only rows with no consent status and no grace date are touched, so running it on every start is safe,
 * and athletes created afterwards (status 'Missing') never get a grace period.
 */
async function backfillConsentGrace(Player, { now = new Date(), days = CONSENT_GRACE_DAYS } = {}) {
  const [count] = await Player.update(
    { consentGraceUntil: new Date(now.getTime() + days * DAY_MS) },
    { where: { consentStatus: null, consentGraceUntil: null } }
  );
  return count;
}

/** Deletes search-log rows older than the retention period. Returns how many were removed. */
async function pruneAccessLog(ScoutAccessLog, { now = new Date(), days = ACCESS_LOG_RETENTION_DAYS } = {}) {
  return ScoutAccessLog.destroy({ where: { createdAt: { [Op.lt]: new Date(now.getTime() - days * DAY_MS) } } });
}

module.exports = {
  ORG_TYPES, CONSENT_GRACE_DAYS, CONTACT_COOLDOWN_DAYS, ACCESS_LOG_RETENTION_DAYS, contactCooldownEnds, pruneAccessLog,
  publicName, ageFromDob, dobCutoffForUnder, isVisibleToScouts, visibleToScoutsWhere,
  toScoutAthlete, scoutBody, validateAccreditation, backfillConsentGrace
};
