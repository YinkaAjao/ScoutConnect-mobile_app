// routes/shortlist.js
// A scout's private shortlist and notes.
const express = require('express');
const { Player, Evaluation, Shortlist, Club } = require('../models');
const { latestRequestsFor, signedPhotos, SCOUT_PLAYER_ATTRIBUTES, SCOUT_EVALUATION_ATTRIBUTES, SCOUT_CLUB_ATTRIBUTES } = require('../services/scoutData');
const { authenticateToken, requireRole, requireApprovedScout } = require('../middleware/auth');
const scouts = require('../lib/scouts');

const router = express.Router();

// --- SHORTLIST (scouts) ---
router.post('/shortlist', authenticateToken, requireApprovedScout, async (req, res) => {
  const { playerId } = req.body;
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);
  const scoutId = req.user.id;
  try {
    const player = playerId ? await Player.findByPk(playerId, { attributes: ['id', 'consentStatus', 'consentGraceUntil'] }) : null;
    if (!player || !scouts.isVisibleToScouts(player)) return res.status(404).json({ error: 'That athlete is not available.' });

    const existing = await Shortlist.findOne({ where: { scoutId, playerId } });
    if (existing) return res.status(400).json({ error: 'Athlete is already in your shortlist.' });
    const entry = await Shortlist.create({ scoutId, playerId, notes: notes || null });
    res.status(201).json({ message: 'Added to shortlist!', entry });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to shortlist.' });
  }
});

router.get('/shortlist', authenticateToken, requireApprovedScout, async (req, res) => {
  const scoutId = req.user.id;
  const now = new Date();
  try {
    const entries = await Shortlist.findAll({
      where: { scoutId },
      include: [{
        model: Player,
        attributes: SCOUT_PLAYER_ATTRIBUTES,
        include: [
          { model: Evaluation, attributes: SCOUT_EVALUATION_ATTRIBUTES },
          { model: Club, attributes: SCOUT_CLUB_ATTRIBUTES }
        ]
      }],
      order: [['createdAt', 'DESC']]
    });

    const plainEntries = entries.map((entry) => (typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry }));
    const requests = await latestRequestsFor(scoutId, plainEntries.map((e) => e.Player?.id).filter(Boolean));
    const photoUrls = await signedPhotos(req, plainEntries.map((e) => e.Player).filter(Boolean));

    res.status(200).json(plainEntries.map((entry) => {
      const visible = entry.Player && scouts.isVisibleToScouts(entry.Player, now);
      return {
        id: entry.id,
        notes: entry.notes || null,
        createdAt: entry.createdAt,
        // An athlete whose consent lapsed (or who was removed) stays in the list, but only as a placeholder.
        unavailable: !visible,
        Player: visible ? scouts.toScoutAthlete(entry.Player, { now, request: requests.get(entry.Player.id), photoUrl: photoUrls.get(entry.Player.profilePhoto) }) : null
      };
    }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shortlist.' });
  }
});

// Edit the private note on a shortlist entry.
router.patch('/shortlist/:id', authenticateToken, requireRole('Scout'), async (req, res) => {
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);
  try {
    const [updated] = await Shortlist.update({ notes: notes || null }, { where: { id: req.params.id, scoutId: req.user.id } });
    if (updated) res.status(200).json({ id: req.params.id, notes: notes || null });
    else res.status(404).json({ error: 'Shortlist entry not found.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update the note.' });
  }
});

router.delete('/shortlist/:id', authenticateToken, requireRole('Scout'), async (req, res) => {
  try {
    const deleted = await Shortlist.destroy({ where: { id: req.params.id, scoutId: req.user.id } });
    if (deleted) res.status(200).json({ message: 'Removed from shortlist.' });
    else res.status(404).json({ error: 'Shortlist entry not found.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from shortlist.' });
  }
});

module.exports = router;
