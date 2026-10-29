// routes/roster.js
// A club's roster, and edits to its athletes' evaluations, match stats and achievements.
const express = require('express');
const { Op } = require('sequelize');
const { sequelize, Player, Evaluation, MatchStat, Achievement, Shortlist, Flag, ContactRequest } = require('../models');
const { normaliseName, isValidDob } = require('../lib/profile');
const { escapeLike, byLowerName, csv, toInt } = require('../lib/query');
const { authenticateToken, requireActiveCoach } = require('../middleware/auth');

const router = express.Router();

// --- COACH: ROSTER ---
// Paginated list with the stats the roster cards need (search by name, filter by position).
router.get('/club/players', authenticateToken, requireActiveCoach, async (req, res) => {
  const page = Math.max(1, toInt(req.query.page, { min: 1 }) || 1);
  const limit = Math.min(50, toInt(req.query.limit, { min: 1 }) || 20);
  const search = normaliseName(req.query.search);

  try {
    const where = { currentClubId: req.user.clubId };
    if (search) where.name = { [Op.iLike]: `%${escapeLike(search)}%` };
    // `positions` is a comma-separated list, so the app can filter by a whole category (e.g. all defenders).
    const positions = csv(req.query.positions);
    if (positions.length) where.position = { [Op.in]: positions };

    const { count, rows } = await Player.findAndCountAll({
      where, limit, offset: (page - 1) * limit, distinct: true, order: [['name', 'ASC']],
      include: [
        { model: MatchStat, attributes: ['id', 'goals', 'assists'] },
        { model: Achievement, attributes: ['id'] }
      ]
    });
    // Athletes without a recorded guardian consent (whole club, not just this page): hidden from scouts once any grace period ends.
    const needsConsent = await Player.count({
      where: { currentClubId: req.user.clubId, [Op.or]: [{ consentStatus: null }, { consentStatus: { [Op.ne]: 'Recorded' } }] }
    });

    res.status(200).json({ players: rows, totalItems: count, totalPages: Math.ceil(count / limit), currentPage: page, needsConsent });
  } catch (error) {
    console.error('Roster error:', error);
    res.status(500).json({ error: 'Failed to fetch club roster.' });
  }
});

// Whole roster, minimal fields: for pickers and pre-filling the evaluation form.
router.get('/club/roster', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const players = await Player.findAll({
      where: { currentClubId: req.user.clubId },
      attributes: ['id', 'name', 'dateOfBirth', 'position'],
      order: [['name', 'ASC']]
    });
    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch club roster.' });
  }
});

router.put('/club/players/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const { name, dateOfBirth, position, consent, guardianName } = req.body;
  const updates = {};

  if (name !== undefined) {
    if (!normaliseName(name)) return res.status(400).json({ error: 'Athlete name cannot be empty.' });
    updates.name = normaliseName(name);
  }
  if (dateOfBirth !== undefined) {
    if (!isValidDob(dateOfBirth)) return res.status(400).json({ error: 'Date of birth must be a valid date (YYYY-MM-DD).' });
    updates.dateOfBirth = dateOfBirth;
  }
  if (position !== undefined) {
    if (!normaliseName(position)) return res.status(400).json({ error: 'Position cannot be empty.' });
    updates.position = normaliseName(position);
  }
  if (consent !== undefined) {
    if (consent === true || consent === 'true') {
      const guardian = normaliseName(guardianName);
      if (!guardian) return res.status(400).json({ error: "Enter the parent or guardian's name to record consent." });
      Object.assign(updates, {
        consentStatus: 'Recorded', consentGuardian: guardian.slice(0, 120), consentRecordedAt: new Date(),
        consentRecordedBy: req.user.id, consentGraceUntil: null
      });
    } else {
      // Withdrawing consent hides the athlete from scouts straight away (the grace period is cleared too).
      Object.assign(updates, {
        consentStatus: 'Missing', consentGuardian: null, consentRecordedAt: null, consentRecordedBy: null, consentGraceUntil: null
      });
    }
  }

  try {
    const player = await Player.findOne({ where: { id: req.params.id, currentClubId: req.user.clubId } });
    if (!player) return res.status(404).json({ error: 'Athlete not found in your roster.' });

    const nextName = updates.name ?? player.name;
    const nextDob = updates.dateOfBirth ?? player.dateOfBirth;
    const clash = await Player.findOne({
      where: { [Op.and]: [byLowerName(nextName), { dateOfBirth: nextDob, currentClubId: req.user.clubId, id: { [Op.ne]: player.id } }] }
    });
    if (clash) return res.status(409).json({ error: 'An athlete with that name and date of birth is already on your roster.' });

    await player.update(updates);
    res.status(200).json({ player });
  } catch (error) {
    console.error('Athlete update error:', error);
    res.status(500).json({ error: 'Failed to update athlete.' });
  }
});

router.delete('/club/players/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const player = await Player.findOne({ where: { id: req.params.id, currentClubId: req.user.clubId }, transaction });
    if (!player) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Athlete not found in your roster.' });
    }
    const where = { playerId: player.id };
    await Promise.all([
      Evaluation.destroy({ where, transaction }),
      MatchStat.destroy({ where, transaction }),
      Achievement.destroy({ where, transaction }),
      Shortlist.destroy({ where, transaction }),
      Flag.destroy({ where, transaction }),
      ContactRequest.destroy({ where, transaction })
    ]);
    await player.destroy({ transaction });
    await transaction.commit();
    res.status(200).json({ message: 'Athlete removed from roster.' });
  } catch (error) {
    await transaction.rollback();
    console.error('Athlete delete error:', error);
    res.status(500).json({ error: 'Failed to remove athlete.' });
  }
});

// --- COACH: EVALUATIONS / MATCH STATS / ACHIEVEMENTS ---
// A record is only reachable if its athlete belongs to the coach's own club.
const findOwnedRecord = (Model, req) =>
  Model.findOne({
    where: { id: req.params.id },
    include: [{ model: Player, attributes: ['id'], where: { currentClubId: req.user.clubId }, required: true }]
  });

// Evaluations are cryptographically signed at sync time, so they can be removed but never edited.
router.delete('/club/evaluations/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const record = await findOwnedRecord(Evaluation, req);
    if (!record) return res.status(404).json({ error: 'Evaluation not found in your roster.' });
    await record.destroy();
    res.status(200).json({ message: 'Evaluation removed.' });
  } catch (error) {
    console.error('Evaluation delete error:', error);
    res.status(500).json({ error: 'Failed to remove evaluation.' });
  }
});

router.put('/club/match-stats/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const { competition, opponent, matchResult, matchDate, goals, assists, minutesPlayed } = req.body;
  const updates = {};

  if (competition !== undefined) {
    if (!normaliseName(competition)) return res.status(400).json({ error: 'Competition cannot be empty.' });
    updates.competition = normaliseName(competition);
  }
  if (opponent !== undefined) updates.opponent = normaliseName(opponent) || null;
  if (matchResult !== undefined) updates.matchResult = normaliseName(matchResult) || null;
  if (matchDate !== undefined) {
    if (!isValidDob(matchDate)) return res.status(400).json({ error: 'Match date must be a valid date (YYYY-MM-DD).' });
    updates.matchDate = matchDate;
  }
  for (const [key, val, max] of [['goals', goals, 99], ['assists', assists, 99], ['minutesPlayed', minutesPlayed, 150]]) {
    if (val === undefined) continue;
    const n = toInt(val, { max });
    if (n === null) return res.status(400).json({ error: `${key} must be a whole number between 0 and ${max}.` });
    updates[key] = n;
  }

  try {
    const record = await findOwnedRecord(MatchStat, req);
    if (!record) return res.status(404).json({ error: 'Match record not found in your roster.' });
    await record.update(updates);
    res.status(200).json({ matchStat: record });
  } catch (error) {
    console.error('Match stat update error:', error);
    res.status(500).json({ error: 'Failed to update match record.' });
  }
});

router.delete('/club/match-stats/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const record = await findOwnedRecord(MatchStat, req);
    if (!record) return res.status(404).json({ error: 'Match record not found in your roster.' });
    await record.destroy();
    res.status(200).json({ message: 'Match record removed.' });
  } catch (error) {
    console.error('Match stat delete error:', error);
    res.status(500).json({ error: 'Failed to remove match record.' });
  }
});

router.put('/club/achievements/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  const { title, year } = req.body;
  const updates = {};

  if (title !== undefined) {
    if (!normaliseName(title)) return res.status(400).json({ error: 'Title cannot be empty.' });
    updates.title = normaliseName(title).slice(0, 255);
  }
  if (year !== undefined) {
    const n = toInt(year, { min: 1900, max: new Date().getFullYear() + 1 });
    if (n === null) return res.status(400).json({ error: 'Year must be a valid year.' });
    updates.year = n;
  }

  try {
    const record = await findOwnedRecord(Achievement, req);
    if (!record) return res.status(404).json({ error: 'Achievement not found in your roster.' });
    await record.update(updates);
    res.status(200).json({ achievement: record });
  } catch (error) {
    console.error('Achievement update error:', error);
    res.status(500).json({ error: 'Failed to update achievement.' });
  }
});

router.delete('/club/achievements/:id', authenticateToken, requireActiveCoach, async (req, res) => {
  try {
    const record = await findOwnedRecord(Achievement, req);
    if (!record) return res.status(404).json({ error: 'Achievement not found in your roster.' });
    await record.destroy();
    res.status(200).json({ message: 'Achievement removed.' });
  } catch (error) {
    console.error('Achievement delete error:', error);
    res.status(500).json({ error: 'Failed to remove achievement.' });
  }
});

module.exports = router;
