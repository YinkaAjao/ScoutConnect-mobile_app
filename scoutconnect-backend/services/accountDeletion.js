// services/accountDeletion.js
// Deleting your own account (right to erasure, Law No. 058/2021 Art. 23).
//
// What is removed, and what is deliberately kept:
// - The person's name, email, phone and sign-in are removed. The user row stays as an anonymous stub ("Deleted user")
//   so foreign keys in club history and contact requests keep working.
// - A scout's accreditation details, uploaded documents, shortlist and request messages are removed.
// - Athlete records are NOT the coach's personal data. They belong to the club, so they stay with the club,
//   and a sole club owner must hand over or remove them first (otherwise children's records would have no one
//   able to manage consent or removal).
// - The scout access log keeps only the scout's anonymous id and is deleted by the existing 90-day pruning.

const DELETED_DOMAIN = 'deleted.invalid';
const REMOVED_MESSAGE = '[Removed when the scout deleted their account]';

const isDeletedEmail = (email) => typeof email === 'string' && email.toLowerCase().endsWith(`@${DELETED_DOMAIN}`);
const isDeletedAccount = (user) => Boolean(user) && isDeletedEmail(user.email);
const deletedEmailFor = (userId) => `deleted-${userId}@${DELETED_DOMAIN}`;

const isActiveMember = (u) => (u.membershipStatus || 'Active') === 'Active';
const isOwner = (u) => (u.clubRole || 'Owner') === 'Owner';

/**
 * Why this account cannot be deleted yet, or null. A coach who is the club's only active owner must first
 * remove the athletes or make sure another owner exists, so no child's record is left without a manager.
 */
function deletionBlocker(user, { clubUsers = [], athleteCount = 0 } = {}) {
  if (user.role !== 'Coach' || !user.clubId) return null;
  if (!isOwner(user) || !isActiveMember(user)) return null;

  const otherActiveOwners = clubUsers.filter((u) => u.id !== user.id && isOwner(u) && isActiveMember(u));
  if (otherActiveOwners.length > 0) return null;

  if (athleteCount > 0) {
    return `You are the only owner of your club and it still holds ${athleteCount} athlete record${athleteCount === 1 ? '' : 's'}. Remove those records first, so no child's data is left without someone to manage it.`;
  }
  return null;
}

/** Request body must repeat the account's email, so a stray tap or a stolen open session cannot delete it. */
const confirmationMatches = (user, confirm) =>
  typeof confirm === 'string' && confirm.trim().toLowerCase() === String(user.email).toLowerCase();

function createAccountDeleter({ sequelize, models, supabaseUrl, serviceKey, fetchImpl = fetch, logger = console }) {
  const { User, Player, Shortlist, ScoutProfile, VerificationDocument, ContactRequest } = models;
  const enabled = Boolean(supabaseUrl && serviceKey);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  async function removeStoredFiles(paths) {
    if (paths.length === 0) return;
    try {
      const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/verification-docs`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths })
      });
      if (!response.ok) logger.error(`Could not delete ${paths.length} stored document(s): HTTP ${response.status}`);
    } catch (error) {
      logger.error('Could not delete stored documents:', error.message);
    }
  }

  async function removeSignIn(userId) {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 404) throw new Error(`Supabase returned HTTP ${response.status}`);
  }

  /** @returns {Promise<{ok: true} | {ok: false, status: number, error: string, code?: string}>} */
  async function deleteAccount(user, confirm) {
    if (user.isAdmin) return { ok: false, status: 403, error: 'Administrator accounts cannot be deleted here.' };
    if (!confirmationMatches(user, confirm)) {
      return { ok: false, status: 400, error: 'Type your email address exactly to confirm.', code: 'CONFIRM_MISMATCH' };
    }
    if (!enabled) {
      return { ok: false, status: 503, error: 'Account deletion is not available right now. Nothing was changed.', code: 'NOT_CONFIGURED' };
    }

    if (user.role === 'Coach' && user.clubId) {
      const [clubUsers, athleteCount] = await Promise.all([
        User.findAll({ where: { clubId: user.clubId, role: 'Coach' }, attributes: ['id', 'clubRole', 'membershipStatus'] }),
        Player.count({ where: { currentClubId: user.clubId } })
      ]);
      const reason = deletionBlocker(user, { clubUsers, athleteCount });
      if (reason) return { ok: false, status: 409, error: reason, code: 'CLUB_HAS_ATHLETES' };
    }

    let filePaths = [];
    await sequelize.transaction(async (transaction) => {
      if (user.role === 'Scout') {
        const docs = await VerificationDocument.findAll({ where: { scoutUserId: user.id }, transaction });
        filePaths = docs.map((d) => d.storagePath).filter(Boolean);
        await Shortlist.destroy({ where: { scoutId: user.id }, transaction });
        await VerificationDocument.destroy({ where: { scoutUserId: user.id }, transaction });
        await ScoutProfile.destroy({ where: { userId: user.id }, transaction });
        // Requests stay in the club's history, but the scout's words go and anything still open is closed.
        await ContactRequest.update({ message: REMOVED_MESSAGE }, { where: { scoutId: user.id }, transaction });
        await ContactRequest.update({ status: 'Withdrawn' }, { where: { scoutId: user.id, status: 'Pending' }, transaction });
      }
      await User.update(
        { username: 'Deleted user', email: deletedEmailFor(user.id), phone: null, clubId: null, membershipStatus: 'Rejected' },
        { where: { id: user.id }, transaction }
      );
    });

    await removeStoredFiles(filePaths);
    try {
      await removeSignIn(user.id);
    } catch (error) {
      // The profile is already anonymised and the token check rejects it, so access is closed either way.
      logger.error(`Account ${user.id} anonymised but its sign-in could not be removed: ${error.message}`);
    }
    return { ok: true };
  }

  return { enabled, deleteAccount };
}

module.exports = {
  DELETED_DOMAIN, REMOVED_MESSAGE, isDeletedAccount, deletedEmailFor, deletionBlocker, confirmationMatches, createAccountDeleter
};
