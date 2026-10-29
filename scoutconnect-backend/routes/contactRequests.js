// routes/contactRequests.js
// Contact requests: scouts ask, the club owner decides.
const express = require('express');
const { Op } = require('sequelize');
const { User, Player, Club, ScoutProfile, ContactRequest } = require('../models');
const { normaliseName } = require('../lib/profile');
const { sendEmail } = require('../services/notifications');
const { signedPhotos } = require('../services/scoutData');
const { authenticateToken, requireClubOwner, requireApprovedScout } = require('../middleware/auth');
const emails = require('../lib/emails');
const scouts = require('../lib/scouts');

const router = express.Router();

// --- CONTACT REQUESTS: scout side ---
// A scout never gets a club's phone or email directly: they ask, and the club owner decides.
const DAILY_CONTACT_REQUEST_LIMIT = 10;

router.post('/contact-requests', authenticateToken, requireApprovedScout, async (req, res) => {
  const message = String(req.body.message ?? '').trim();
  if (message.length < 10) return res.status(400).json({ error: 'Write a short message (at least 10 characters) so the club knows why you are asking.' });
  if (message.length > 500) return res.status(400).json({ error: 'Please keep the message under 500 characters.' });

  try {
    const player = req.body.playerId
      ? await Player.findByPk(req.body.playerId, { include: [{ model: Club, attributes: ['id', 'name'] }] })
      : null;
    if (!player || !scouts.isVisibleToScouts(player)) return res.status(404).json({ error: 'That athlete is not available.' });

    const open = await ContactRequest.findOne({ where: { scoutId: req.user.id, playerId: player.id, status: { [Op.in]: ['Pending', 'Accepted'] } } });
    if (open) {
      return res.status(409).json({
        error: open.status === 'Accepted' ? 'The club already accepted. Their details are in your Requests tab.' : 'You already have a request waiting for this athlete.'
      });
    }

    const lastDecline = await ContactRequest.findOne({
      where: { scoutId: req.user.id, playerId: player.id, status: 'Declined' },
      order: [['respondedAt', 'DESC']]
    });
    const cooldownEnds = scouts.contactCooldownEnds(lastDecline);
    if (cooldownEnds) {
      return res.status(429).json({
        error: `The club declined your last request. You can ask again on ${cooldownEnds.toISOString().slice(0, 10)}.`,
        code: 'COOLDOWN',
        canRequestAgainAt: cooldownEnds.toISOString()
      });
    }

    const recent = await ContactRequest.count({ where: { scoutId: req.user.id, createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    if (recent >= DAILY_CONTACT_REQUEST_LIMIT) {
      return res.status(429).json({ error: `You can send up to ${DAILY_CONTACT_REQUEST_LIMIT} contact requests a day. Please try again tomorrow.`, code: 'RATE_LIMITED' });
    }

    const request = await ContactRequest.create({ scoutId: req.user.id, playerId: player.id, clubId: player.currentClubId, message });

    // Tell the club's owner(s); best effort.
    const owners = await User.findAll({ where: { clubId: player.currentClubId, role: 'Coach', clubRole: 'Owner' }, attributes: ['email', 'membershipStatus'] });
    await sendEmail(req, {
      to: owners.filter((o) => (o.membershipStatus || 'Active') === 'Active').map((o) => o.email),
      ...emails.contactRequestEmail({ club: player.Club || { name: 'your club' }, athleteName: player.name, scout: req.user, organisation: req.scoutProfile?.organisation, message })
    });

    res.status(201).json({ id: request.id, status: 'Pending' });
  } catch (error) {
    console.error('Contact request error:', error);
    res.status(500).json({ error: 'Failed to send your request.' });
  }
});

router.get('/contact-requests', authenticateToken, requireApprovedScout, async (req, res) => {
  try {
    const requests = await ContactRequest.findAll({
      where: { scoutId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 100,
      include: [
        { model: Player, attributes: ['id', 'name', 'position', 'dateOfBirth', 'profilePhoto'] },
        { model: Club, attributes: ['name', 'isVerified', 'contactEmail', 'contactPhone'] }
      ]
    });
    const now = new Date();
    const photoUrls = await signedPhotos(req, requests.map((r) => r.Player).filter(Boolean));

    res.status(200).json(requests.map((row) => {
      const request = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      const accepted = request.status === 'Accepted';
      const player = request.Player;
      return {
        id: request.id,
        status: request.status,
        message: request.message,
        responseNote: request.status === 'Pending' ? null : request.responseNote || null,
        createdAt: request.createdAt,
        respondedAt: request.respondedAt || null,
        athlete: player
          ? {
              id: player.id,
              displayName: accepted ? normaliseName(player.name) : scouts.publicName(player.name),
              position: player.position,
              age: scouts.ageFromDob(player.dateOfBirth, now),
              profilePhoto: photoUrls.get(player.profilePhoto) || null
            }
          : null,
        club: request.Club
          ? {
              name: request.Club.name,
              isVerified: Boolean(request.Club.isVerified),
              ...(accepted ? { contactEmail: request.Club.contactEmail || null, contactPhone: request.Club.contactPhone || null } : {})
            }
          : null
      };
    }));
  } catch (error) {
    console.error('Contact request list error:', error);
    res.status(500).json({ error: 'Failed to load your requests.' });
  }
});

// --- CONTACT REQUESTS: club owner side ---
router.get('/club/contact-requests', authenticateToken, ...requireClubOwner, async (req, res) => {
  const status = ['Pending', 'Accepted', 'Declined'].includes(req.query.status) ? req.query.status : null;
  try {
    const requests = await ContactRequest.findAll({
      where: { clubId: req.user.clubId, ...(status ? { status } : {}) },
      order: [['createdAt', 'DESC']],
      limit: 100,
      include: [
        { model: Player, attributes: ['id', 'name', 'position'] },
        { model: User, as: 'Scout', attributes: ['id', 'username', 'email', 'phone'] }
      ]
    });

    const scoutIds = [...new Set(requests.map((r) => r.scoutId))];
    const profiles = scoutIds.length ? await ScoutProfile.findAll({ where: { userId: { [Op.in]: scoutIds } } }) : [];
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    res.status(200).json(requests.map((row) => {
      const request = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      const profile = profileByUser.get(request.scoutId);
      const accepted = request.status === 'Accepted';
      return {
        id: request.id,
        status: request.status,
        message: request.message,
        responseNote: request.responseNote || null,
        createdAt: request.createdAt,
        respondedAt: request.respondedAt || null,
        athlete: request.Player ? { id: request.Player.id, name: request.Player.name, position: request.Player.position } : null,
        scout: {
          username: request.Scout?.username || 'Unknown',
          organisation: profile?.organisation || null,
          orgType: profile?.orgType || null,
          // The scout's own contact details are shared with the club only once the club has accepted.
          ...(accepted ? { email: request.Scout?.email || null, phone: request.Scout?.phone || null } : {})
        }
      };
    }));
  } catch (error) {
    console.error('Club contact request list error:', error);
    res.status(500).json({ error: 'Failed to load scout requests.' });
  }
});

router.put('/club/contact-requests/:id', authenticateToken, ...requireClubOwner, async (req, res) => {
  const { decision } = req.body;
  const note = normaliseName(req.body.note).slice(0, 300);
  if (!['accept', 'decline'].includes(decision)) return res.status(400).json({ error: 'Decision must be "accept" or "decline".' });

  try {
    const request = await ContactRequest.findOne({ where: { id: req.params.id, clubId: req.user.clubId } });
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'Pending') return res.status(409).json({ error: `This request was already ${String(request.status).toLowerCase()}.` });

    await request.update({
      status: decision === 'accept' ? 'Accepted' : 'Declined',
      responseNote: note || null,
      respondedBy: req.user.id,
      respondedAt: new Date()
    });

    try {
      const [scoutUser, player, club] = await Promise.all([
        User.findByPk(request.scoutId, { attributes: ['email'] }),
        Player.findByPk(request.playerId, { attributes: ['name'] }),
        Club.findByPk(request.clubId, { attributes: ['name'] })
      ]);
      await sendEmail(req, {
        to: scoutUser?.email,
        ...emails.contactResponseEmail({
          decision,
          athleteName: decision === 'accept' ? player?.name : scouts.publicName(player?.name),
          clubName: club?.name,
          note
        })
      });
    } catch (error) {
      console.error('Could not notify the scout:', error.message);
    }

    res.status(200).json({ id: request.id, status: request.status });
  } catch (error) {
    console.error('Contact request decision error:', error);
    res.status(500).json({ error: 'Failed to record your answer.' });
  }
});

module.exports = router;
