// routes/reports.js
// Reports about athlete profiles, and the administrators' review queue.
const express = require('express');
const { Op } = require('sequelize');
const { sequelize, User, Player, Club, Flag, ScoutProfile } = require('../models');
const { validateReport, URGENT_CATEGORIES } = require('../lib/reports');
const { normaliseName } = require('../lib/profile');
const { membershipOf } = require('../lib/membership');
const { sendEmail, adminRecipients } = require('../services/notifications');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const emails = require('../lib/emails');
const scouts = require('../lib/scouts');

const router = express.Router();

// --- REPORTS (flags) ---
// Anyone who can see an athlete can report a problem with their profile. Administrators review the reports.
router.post('/flags', authenticateToken, async (req, res) => {
  const parsed = validateReport(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const reporterId = req.user.id;
  const { playerId } = req.body;

  if (req.user.isAdmin) return res.status(403).json({ error: 'Administrators review reports; they do not file them.' });
  if (req.user.role === 'Coach' && membershipOf(req.user) !== 'Active') {
    return res.status(403).json({ error: 'Your club membership is not active.', code: 'MEMBERSHIP_PENDING' });
  }

  try {
    if (req.user.role === 'Scout') {
      const profile = await ScoutProfile.findOne({ where: { userId: reporterId } });
      const status = profile?.status || 'Pending';
      if (status !== 'Approved') {
        return res.status(403).json({ error: 'Your scout accreditation has not been approved yet.', code: 'SCOUT_NOT_APPROVED', accreditationStatus: status });
      }
    }

    const player = playerId ? await Player.findByPk(playerId, { include: [Club] }) : null;
    // A scout can only report an athlete they are able to see.
    if (!player || (req.user.role === 'Scout' && !scouts.isVisibleToScouts(player))) return res.status(404).json({ error: 'Player not found.' });
    if (req.user.clubId && player.currentClubId === req.user.clubId) {
      return res.status(403).json({ error: 'You cannot report athletes from your own club.' });
    }
    if (await Flag.findOne({ where: { reporterId, playerId, status: 'Pending' } })) {
      return res.status(409).json({ error: 'You have already reported this profile.' });
    }

    const flag = await Flag.create({ reporterId, playerId, category: parsed.category, reason: parsed.details });

    if (player.Club) {
      // Count distinct reporters, so a single account can't penalise a rival club on its own.
      const pendingFlags = await Flag.findAll({
        attributes: ['reporterId'],
        where: { status: 'Pending' },
        include: [{ model: Player, attributes: [], where: { currentClubId: player.Club.id }, required: true }],
        raw: true
      });
      const uniqueReporters = new Set(pendingFlags.map((f) => f.reporterId)).size;
      if (uniqueReporters >= 5 && player.Club.standingStatus !== 'Penalized') {
        await player.Club.update({
          standingStatus: 'Penalized',
          trustScore: Math.max(0, (player.Club.trustScore || 100) - 15)
        });
      }
    }

    await sendEmail(req, {
      to: adminRecipients(),
      ...emails.reportEmail({ athleteName: player.name, clubName: player.Club?.name, category: parsed.category, details: parsed.details, reporter: req.user })
    });

    res.status(201).json({ message: 'Thank you. An administrator will review your report.', id: flag.id });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to submit your report.' });
  }
});

router.get('/admin/reports', authenticateToken, requireAdmin, async (req, res) => {
  const status = ['Pending', 'Resolved', 'Dismissed'].includes(req.query.status) ? req.query.status : 'Pending';
  try {
    const flags = await Flag.findAll({
      where: { status },
      order: [['createdAt', status === 'Pending' ? 'ASC' : 'DESC']],
      limit: 50,
      include: [
        { model: Player, attributes: ['id', 'name', 'position', 'currentClubId', 'scoutHidden', 'scoutHiddenReason'] },
        { model: User, attributes: ['username', 'role'] }
      ]
    });

    const clubIds = [...new Set(flags.map((f) => f.Player?.currentClubId).filter(Boolean))];
    const clubs = clubIds.length ? await Club.findAll({ where: { id: { [Op.in]: clubIds } }, attributes: ['id', 'name'] }) : [];
    const clubName = new Map(clubs.map((c) => [c.id, c.name]));

    const items = flags.map((row) => {
      const flag = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      return {
        id: flag.id,
        category: flag.category || 'Other',
        details: flag.reason,
        status: flag.status,
        createdAt: flag.createdAt,
        resolutionNote: flag.resolutionNote || null,
        resolvedAt: flag.resolvedAt || null,
        athlete: flag.Player
          ? { id: flag.Player.id, name: flag.Player.name, position: flag.Player.position, scoutHidden: Boolean(flag.Player.scoutHidden), scoutHiddenReason: flag.Player.scoutHiddenReason || null }
          : null,
        club: flag.Player ? { name: clubName.get(flag.Player.currentClubId) || null } : null,
        reporter: flag.User ? { username: flag.User.username, role: flag.User.role } : null
      };
    });
    // Safeguarding concerns always come first.
    items.sort((a, b) => Number(URGENT_CATEGORIES.includes(b.category)) - Number(URGENT_CATEGORIES.includes(a.category)));

    res.status(200).json(items);
  } catch (error) {
    console.error('Admin report list error:', error);
    res.status(500).json({ error: 'Failed to load reports.' });
  }
});

router.put('/admin/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { decision, hideAthlete } = req.body;
  const note = normaliseName(req.body.reason).slice(0, 500);
  if (!['resolve', 'dismiss'].includes(decision)) return res.status(400).json({ error: 'Decision must be "resolve" or "dismiss".' });
  if (decision === 'resolve' && !note) return res.status(400).json({ error: 'Add a note saying what was done.' });

  try {
    const flag = await Flag.findByPk(req.params.id);
    if (!flag) return res.status(404).json({ error: 'Report not found.' });
    if (flag.status !== 'Pending') return res.status(409).json({ error: `This report was already ${String(flag.status).toLowerCase()}.` });

    await sequelize.transaction(async (transaction) => {
      await flag.update({
        status: decision === 'resolve' ? 'Resolved' : 'Dismissed',
        resolutionNote: note || null,
        resolvedBy: req.user.id,
        resolvedAt: new Date()
      }, { transaction });
      if (decision === 'resolve' && hideAthlete === true) {
        await Player.update({ scoutHidden: true, scoutHiddenReason: note.slice(0, 255) }, { where: { id: flag.playerId }, transaction });
      }
    });

    try {
      const reporter = await User.findByPk(flag.reporterId, { attributes: ['email'] });
      await sendEmail(req, { to: reporter?.email, ...emails.reportOutcomeEmail({ decision }) });
    } catch (error) {
      console.error('Could not notify the reporter:', error.message);
    }

    res.status(200).json({ id: flag.id, status: flag.status });
  } catch (error) {
    console.error('Admin report decision error:', error);
    res.status(500).json({ error: 'Failed to record the decision.' });
  }
});

// Hide an athlete from scouts, or bring them back (for example after a report was investigated).
router.put('/admin/players/:id/scout-visibility', authenticateToken, requireAdmin, async (req, res) => {
  const hidden = req.body.hidden === true;
  const reason = normaliseName(req.body.reason).slice(0, 255);
  if (hidden && !reason) return res.status(400).json({ error: 'A reason is required to hide an athlete.' });

  try {
    const player = await Player.findByPk(req.params.id, { attributes: ['id'] });
    if (!player) return res.status(404).json({ error: 'Athlete not found.' });
    await Player.update({ scoutHidden: hidden, scoutHiddenReason: hidden ? reason : null }, { where: { id: player.id } });
    res.status(200).json({ id: player.id, scoutHidden: hidden });
  } catch (error) {
    console.error('Visibility update error:', error);
    res.status(500).json({ error: 'Failed to update visibility.' });
  }
});

module.exports = router;
