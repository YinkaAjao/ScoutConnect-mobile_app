// routes/players.js
// Athlete search and profiles: a minimised view for scouts, the full record for the club's own coaches.
const express = require('express');
const { Op } = require('sequelize');
const { Player, Evaluation, MatchStat, Achievement, Shortlist, Club } = require('../models');
const { normaliseName } = require('../lib/profile');
const { membershipOf } = require('../lib/membership');
const { escapeLike, csv, toInt } = require('../lib/query');
const { logScoutAccess, latestRequestsFor, signedPhotos, SCOUT_PLAYER_ATTRIBUTES, SCOUT_EVALUATION_ATTRIBUTES, SCOUT_CLUB_ATTRIBUTES } = require('../services/scoutData');
const { authenticateToken, requireApprovedScout, limitScoutSearches } = require('../middleware/auth');
const scouts = require('../lib/scouts');

const router = express.Router();

// --- SCOUT-FACING PLAYER SEARCH ---
// Scouts get a minimised view (see lib/scouts.js): masked name, age instead of date of birth, no club contact until accepted.
const SCOUT_PAGE_MAX = 20;
const SCOUT_SORTS = {
  name: [['name', 'ASC'], ['id', 'ASC']],
  youngest: [['dateOfBirth', 'DESC'], ['name', 'ASC'], ['id', 'ASC']],
  oldest: [['dateOfBirth', 'ASC'], ['name', 'ASC'], ['id', 'ASC']]
};

router.get('/players', authenticateToken, requireApprovedScout, limitScoutSearches, async (req, res) => {
  const { evalType, position } = req.query;
  const page = Math.max(1, toInt(req.query.page, { min: 1 }) || 1);
  const limit = Math.min(SCOUT_PAGE_MAX, toInt(req.query.limit, { min: 1 }) || 10);
  const offset = (page - 1) * limit;
  const now = new Date();

  try {
    const playerWhere = {};
    const conditions = [scouts.visibleToScoutsWhere(now)]; // only athletes with consent on record (or still in the grace period)

    const search = normaliseName(req.query.search);
    if (search) playerWhere.name = { [Op.iLike]: `%${escapeLike(search)}%` };
    if (position) playerWhere.position = position; // exact match, kept for older app versions

    // `positions` keeps only those positions (e.g. a whole category); `excludePositions` is the "Other" bucket.
    const included = csv(req.query.positions);
    const excluded = csv(req.query.excludePositions);
    if (included.length) playerWhere.position = { [Op.in]: included };
    else if (excluded.length) playerWhere.position = { [Op.notIn]: excluded };

    // `under=15` keeps athletes younger than 15 today.
    const under = toInt(req.query.under, { min: 8, max: 25 });
    if (under) conditions.push({ dateOfBirth: { [Op.gt]: scouts.dobCutoffForUnder(under, now) } });
    // `minAge=15` keeps athletes who are at least 15 today (born on or before the same date 15 years ago); with `under` it makes an age band.
    const minAge = toInt(req.query.minAge, { min: 6, max: 25 });
    if (minAge) conditions.push({ dateOfBirth: { [Op.lte]: scouts.dobCutoffForUnder(minAge, now) } });
    playerWhere[Op.and] = conditions;

    const evaluationInclude = { model: Evaluation, attributes: SCOUT_EVALUATION_ATTRIBUTES };
    if (evalType) evaluationInclude.where = { evalType };

    // `verifiedOnly=true` keeps only athletes whose club has passed admin review.
    const clubInclude = { model: Club, attributes: SCOUT_CLUB_ATTRIBUTES };
    if (req.query.verifiedOnly === 'true') {
      clubInclude.where = { isVerified: true };
      clubInclude.required = true;
    }

    const { count, rows } = await Player.findAndCountAll({
      where: playerWhere, limit, offset, distinct: true,
      attributes: SCOUT_PLAYER_ATTRIBUTES,
      order: SCOUT_SORTS[req.query.sort] || SCOUT_SORTS.name, // always ends with the id, so pages never repeat or skip athletes
      include: [
        evaluationInclude,
        { model: MatchStat, attributes: ['id', 'competition', 'opponent', 'matchResult', 'matchDate', 'goals', 'assists', 'minutesPlayed'] },
        { model: Achievement, attributes: ['id', 'title', 'year'] },
        clubInclude
      ]
    });

    const requests = await latestRequestsFor(req.user.id, rows.map((row) => row.id));
    const photoUrls = await signedPhotos(req, rows);
    await logScoutAccess(req.user.id, 'players', rows.map((row) => row.id));

    res.status(200).json({
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      players: rows.map((row) => scouts.toScoutAthlete(row, { now, request: requests.get(row.id), photoUrl: photoUrls.get(row.profilePhoto) }))
    });
  } catch (error) {
    console.error('Player search error:', error);
    res.status(500).json({ error: 'Failed to fetch players.' });
  }
});

async function scoutAthleteDetail(req, res) {
  const now = new Date();
  try {
    const player = await Player.findByPk(req.params.id, {
      attributes: SCOUT_PLAYER_ATTRIBUTES,
      include: [
        { model: Evaluation, attributes: SCOUT_EVALUATION_ATTRIBUTES },
        { model: MatchStat, attributes: ['id', 'competition', 'opponent', 'matchResult', 'matchDate', 'goals', 'assists', 'minutesPlayed'] },
        { model: Achievement, attributes: ['id', 'title', 'year'] },
        { model: Club, attributes: SCOUT_CLUB_ATTRIBUTES }
      ]
    });
    if (!player || !scouts.isVisibleToScouts(player, now)) return res.status(404).json({ error: 'Player not found.' });

    const requests = await latestRequestsFor(req.user.id, [player.id]);
    const photoUrls = await signedPhotos(req, [player]);
    const shortlisted = await Shortlist.findOne({ where: { scoutId: req.user.id, playerId: player.id } });
    await logScoutAccess(req.user.id, 'player-detail', [player.id]);
    res.status(200).json({
      ...scouts.toScoutAthlete(player, { now, request: requests.get(player.id), photoUrl: photoUrls.get(player.profilePhoto) }),
      shortlistId: shortlisted?.id || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player details.' });
  }
}

async function coachAthleteDetail(req, res) {
  try {
    const player = await Player.findByPk(req.params.id, {
      include: [
        { model: Evaluation },
        { model: MatchStat },
        { model: Achievement },
        { model: Club, attributes: ['name', 'region', 'contactEmail', 'contactPhone', 'standingStatus', 'trustScore'] }
      ],
      order: [[Evaluation, 'createdAt', 'ASC'], [MatchStat, 'matchDate', 'DESC']]
    });
    // Coaches only see their own club's athletes (404, not 403, so other ids are not confirmed to exist).
    const allowed = player && req.user.role === 'Coach' && membershipOf(req.user) === 'Active' && player.currentClubId === req.user.clubId;
    if (!allowed) return res.status(404).json({ error: 'Player not found.' });
    const photoUrls = await signedPhotos(req, [player]);
    res.status(200).json({ ...(typeof player.toJSON === 'function' ? player.toJSON() : player), photoUrl: photoUrls.get(player.profilePhoto) || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch player details.' });
  }
}

router.get('/players/:id', authenticateToken, (req, res) => {
  if (req.user.role === 'Scout') return requireApprovedScout(req, res, () => scoutAthleteDetail(req, res));
  return coachAthleteDetail(req, res);
});

module.exports = router;
