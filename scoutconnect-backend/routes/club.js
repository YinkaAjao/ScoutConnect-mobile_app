// routes/club.js
// The coach's club: details and membership approvals.
const express = require('express');
const { Op } = require('sequelize');
const { User, Player, Club, VerificationEvent } = require('../models');
const { verificationStatusOf } = require('../lib/verification');
const { ENTITY_TYPES, normaliseName, isValidEmail } = require('../lib/profile');
const { membershipOf, clubRoleOf } = require('../lib/membership');
const { byLowerName } = require('../lib/query');
const { authenticateToken, requireRole, requireClubOwner } = require('../middleware/auth');

const router = express.Router();

// --- COACH: CLUB ---
router.get('/club', authenticateToken, requireRole('Coach'), async (req, res) => {
  try {
    const club = req.user.clubId ? await Club.findByPk(req.user.clubId, { attributes: { exclude: ['verifiedBy'] } }) : null;
    if (!club) return res.status(404).json({ error: 'Club not found.' });

    const status = membershipOf(req.user);
    if (status !== 'Active') {
      // Pending/declined coaches see only the basics, plus their status so the app can explain it.
      return res.status(200).json({
        club: { id: club.id, name: club.name, region: club.region, entityType: club.entityType },
        playerCount: 0,
        coachProfile: req.user,
        membershipStatus: status
      });
    }

    const playerCount = await Player.count({ where: { currentClubId: req.user.clubId } });
    res.status(200).json({ club, playerCount, coachProfile: req.user, membershipStatus: status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club information.' });
  }
});

// Update the club's details (owner only; verification/trust stay admin-controlled).
router.put('/club', authenticateToken, ...requireClubOwner, async (req, res) => {
  const { name, region, contactEmail, contactPhone, entityType } = req.body;
  const updates = {};

  if (name !== undefined) {
    if (!normaliseName(name)) return res.status(400).json({ error: 'Club name cannot be empty.' });
    updates.name = normaliseName(name);
  }
  if (entityType !== undefined) {
    if (!ENTITY_TYPES.includes(entityType)) return res.status(400).json({ error: 'Invalid entity classification.' });
    updates.entityType = entityType;
  }
  for (const [key, val] of Object.entries({ region, contactEmail, contactPhone })) {
    if (val !== undefined) updates[key] = normaliseName(val) || null;
  }
  if (updates.contactEmail && !isValidEmail(updates.contactEmail)) {
    return res.status(400).json({ error: 'Please enter a valid contact email.' });
  }

  try {
    const club = await Club.findByPk(req.user.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    if (updates.name) {
      const clash = await Club.findOne({ where: { [Op.and]: [byLowerName(updates.name), { id: { [Op.ne]: club.id } }] } });
      if (clash) return res.status(409).json({ error: 'Another club already uses that name.' });
    }

    // A verified club that changes its name or classification is no longer the entity the admin reviewed.
    const identityChanged = Boolean(
      (updates.name && updates.name !== club.name) || (updates.entityType && updates.entityType !== club.entityType)
    );
    const verificationReset = identityChanged && verificationStatusOf(club) === 'Verified';
    if (verificationReset) {
      Object.assign(updates, { isVerified: false, verificationStatus: 'Unverified', verifiedAt: null, verifiedBy: null });
    }

    await club.update(updates);
    if (verificationReset) {
      await VerificationEvent.create({ clubId: club.id, actorId: req.user.id, action: 'Reset', note: 'Club name or classification changed after verification.' });
    }
    res.status(200).json({ club, verificationReset });
  } catch (error) {
    console.error('Club update error:', error);
    res.status(500).json({ error: 'Failed to update club information.' });
  }
});

// --- COACH: MEMBERSHIP APPROVALS (club owner) ---
router.get('/club/members', authenticateToken, ...requireClubOwner, async (req, res) => {
  try {
    const members = await User.findAll({
      where: { clubId: req.user.clubId, role: 'Coach' },
      attributes: ['id', 'username', 'email', 'phone', 'clubRole', 'membershipStatus', 'createdAt'],
      order: [['createdAt', 'ASC']]
    });
    res.status(200).json(members);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club members.' });
  }
});

router.put('/club/members/:userId', authenticateToken, ...requireClubOwner, async (req, res) => {
  const { action } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be "approve" or "reject".' });

  try {
    const target = await User.findOne({ where: { id: req.params.userId, clubId: req.user.clubId, role: 'Coach' } });
    if (!target) return res.status(404).json({ error: 'Member not found in your club.' });
    if (clubRoleOf(target) === 'Owner') return res.status(400).json({ error: 'Club owners cannot be changed.' });

    await target.update({ membershipStatus: action === 'approve' ? 'Active' : 'Rejected' });
    res.status(200).json({ member: { id: target.id, username: target.username, membershipStatus: target.membershipStatus } });
  } catch (error) {
    console.error('Member update error:', error);
    res.status(500).json({ error: 'Failed to update member.' });
  }
});

module.exports = router;
