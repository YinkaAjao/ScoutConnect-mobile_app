// services/provisioning.js
// First sign-in: builds the Postgres profile from the answers stored in the verified Supabase token.
const { sequelize, User, Club } = require('../models');
const { profileFromClaims } = require('../lib/profile');
const { byLowerName } = require('../lib/query');

/** Creates the Postgres profile for a verified Supabase user from the answers stored at sign-up. */
async function provisionUser(claims) {
  const parsed = profileFromClaims(claims);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }
  const p = parsed.profile;

  return sequelize.transaction(async (transaction) => {
    const base = { id: p.id, username: p.username, email: p.email, phone: p.phone, role: p.role };

    if (p.role === 'Scout') {
      const [user] = await User.findOrCreate({ where: { id: p.id }, defaults: base, transaction });
      return user;
    }

    let club;
    let joining = true;
    if (p.clubId) {
      club = await Club.findByPk(p.clubId, { transaction });
      if (!club) {
        const err = new Error('The selected academy no longer exists.');
        err.status = 400;
        throw err;
      }
    } else {
      // Registering a name that already exists is a request to join it, never a takeover.
      club = await Club.findOne({ where: byLowerName(p.newClub.name), transaction });
      if (!club) {
        club = await Club.create({ ...p.newClub, isVerified: false }, { transaction });
        joining = false;
      }
    }

    const [user] = await User.findOrCreate({
      where: { id: p.id },
      defaults: {
        ...base,
        clubId: club.id,
        clubRole: joining ? 'Member' : 'Owner',
        membershipStatus: joining ? 'Pending' : 'Active'
      },
      transaction
    });
    return user;
  });
}

module.exports = { provisionUser };
