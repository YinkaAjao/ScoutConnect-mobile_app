// lib/profile.js
const ENTITY_TYPES = ['Grassroots Academy', 'Youth Development Hub', 'Registered Club', 'School / University Team'];
const ROLES = ['Coach', 'Scout'];

/** Collapses runs of whitespace and trims, so "  Jean   Paul " and "Jean Paul" are the same name. */
const normaliseName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const isValidDob = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ''));

const clean = (value) => {
  const text = normaliseName(value);
  return text || null;
};

/**
 * Turns the verified claims of a Supabase access token into a registration request.
 * The sign-up form stores its answers in `user_metadata`; this is the only place they are read.
 * Returns { error } or { profile }.
 */
function profileFromClaims(claims) {
  const meta = claims?.user_metadata || {};
  const email = clean(claims?.email)?.toLowerCase();
  const username = clean(meta.username);
  const role = meta.role;

  if (!claims?.sub) return { error: 'Token has no subject.' };
  if (!email) return { error: 'Account has no email address.' };
  if (!username) return { error: 'Account has no name. Please register again.' };
  if (!ROLES.includes(role)) return { error: 'Account has no valid role. Please register again.' };

  const profile = { id: claims.sub, email, username, phone: clean(meta.phone), role };

  if (role === 'Coach') {
    const clubId = clean(meta.clubId);
    const newClubName = clean(meta.newClubName);
    if (clubId) {
      profile.clubId = clubId;
    } else if (newClubName) {
      if (!ENTITY_TYPES.includes(meta.newClubEntityType)) return { error: 'New academies need a valid entity classification.' };
      const contactEmail = clean(meta.newClubContactEmail);
      if (contactEmail && !isValidEmail(contactEmail)) return { error: 'The academy contact email is not valid.' };
      profile.newClub = {
        name: newClubName,
        region: clean(meta.newClubRegion),
        entityType: meta.newClubEntityType,
        contactEmail,
        contactPhone: clean(meta.newClubContactPhone)
      };
    } else {
      return { error: 'Coaches must select or register an academy.' };
    }
  }

  return { profile };
}

module.exports = { ENTITY_TYPES, ROLES, normaliseName, isValidDob, isValidEmail, profileFromClaims };
