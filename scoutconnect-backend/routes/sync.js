// routes/sync.js
// Offline sync from the coach app: idempotent, with partial success.
const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Player, Evaluation, MatchStat, Achievement } = require('../models');
const { normaliseName, isValidDob } = require('../lib/profile');
const { byLowerName } = require('../lib/query');
const { authenticateToken, requireActiveCoach } = require('../middleware/auth');

const router = express.Router();

// --- SYNC (idempotent, partial-success) ---
/**
 * Finds the athlete a synced item refers to. Prefers the server id (survives renames), then name + date of birth.
 * Evaluations may create the athlete; match stats and achievements may not.
 */
async function resolveAthlete(item, clubId, { create, defaults }, transaction) {
  if (item.playerId) {
    const byId = await Player.findOne({ where: { id: item.playerId, currentClubId: clubId }, transaction });
    return byId ? { player: byId } : { reason: 'athlete_removed' };
  }
  const name = normaliseName(item.playerName);
  if (!name || !isValidDob(item.dateOfBirth)) return { reason: 'invalid_athlete_details' };

  const existing = await Player.findOne({
    where: { [Op.and]: [byLowerName(name), { dateOfBirth: item.dateOfBirth, currentClubId: clubId }] },
    transaction
  });
  if (existing) return { player: existing };
  if (!create) return { reason: 'athlete_not_found' };
  const player = await Player.create({ name, dateOfBirth: item.dateOfBirth, currentClubId: clubId, ...defaults }, { transaction });
  return { player };
}

router.post('/sync', authenticateToken, requireActiveCoach, async (req, res) => {
  const { records = [], matchStats = [], achievements = [] } = req.body;
  const clubId = req.user.clubId;
  const coachId = req.user.id;
  const syncedIds = { records: [], matchStats: [], achievements: [] };
  const skipped = [];
  let created = 0;
  let duplicates = 0;

  // Each item commits on its own, so one bad item never rolls back (or blocks) the rest of the batch.
  const processItem = async (type, item, work) => {
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        if (item.clientId) {
          const Model = { records: Evaluation, matchStats: MatchStat, achievements: Achievement }[type];
          if (await Model.findOne({ where: { clientId: item.clientId }, transaction })) return 'duplicate';
        }
        return work(transaction);
      });
      if (outcome === 'duplicate') duplicates += 1;
      else if (outcome === 'created') created += 1;
      else { skipped.push({ type, id: item.id, reason: outcome }); return; }
      syncedIds[type].push(item.id);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError' && item.clientId) {
        duplicates += 1; // a parallel request stored the same item first
        syncedIds[type].push(item.id);
        return;
      }
      console.error(`Sync error (${type} ${item.id}):`, error);
      skipped.push({ type, id: item.id, reason: 'server_error' });
    }
  };

  for (const record of Array.isArray(records) ? records : []) {
    await processItem('records', record, async (transaction) => {
      let parsedChecklist = null;
      if (record.checklistJson) {
        try {
          parsedChecklist = typeof record.checklistJson === 'string' ? JSON.parse(record.checklistJson) : record.checklistJson;
        } catch (e) {
          parsedChecklist = null;
        }
      }
      const resolvedPosition = record.position || parsedChecklist?.position || 'Forward';

      const found = await resolveAthlete(record, clubId, {
        create: true,
        defaults: { position: resolvedPosition, profilePhoto: record.profilePhoto || null, consentStatus: 'Missing' }
      }, transaction);
      if (!found.player) return found.reason;
      const player = found.player;

      const recordDate = new Date(record.timestamp || Date.now());
      if (player.updatedAt < recordDate) {
        await player.update({
          position: resolvedPosition,
          ...(record.profilePhoto && { profilePhoto: record.profilePhoto })
        }, { transaction });
      }

      const signaturePayload = `${coachId}-${player.id}-${record.sprintSpeed}-${record.dribblingScore}-${recordDate.getTime()}`;
      const coachSignature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'fallback_secret').update(signaturePayload).digest('hex');

      await Evaluation.create({
        playerId: player.id,
        clientId: record.clientId || null,
        sprintSpeed: record.sprintSpeed,
        dribblingScore: record.dribblingScore,
        workRate: record.workRate,
        evalType: record.evalType,
        evaluatorName: parsedChecklist?.evaluatorName || null,
        evaluationDate: parsedChecklist?.evaluationDate || null,
        overallRating: parsedChecklist?.overallRating || null,
        strengths: parsedChecklist?.strengths || null,
        areasForImprovement: parsedChecklist?.areasForImprovement || null,
        checklistData: parsedChecklist,
        coachSignature
      }, { transaction });
      return 'created';
    });
  }

  for (const stat of Array.isArray(matchStats) ? matchStats : []) {
    await processItem('matchStats', stat, async (transaction) => {
      const found = await resolveAthlete(stat, clubId, { create: false }, transaction);
      if (!found.player) return found.reason;
      await MatchStat.create({
        playerId: found.player.id,
        clientId: stat.clientId || null,
        competition: stat.competition,
        matchDate: stat.matchDate,
        opponent: stat.opponent,
        matchResult: stat.matchResult,
        goals: stat.goals,
        assists: stat.assists,
        minutesPlayed: stat.minutesPlayed
      }, { transaction });
      return 'created';
    });
  }

  for (const ach of Array.isArray(achievements) ? achievements : []) {
    await processItem('achievements', ach, async (transaction) => {
      const found = await resolveAthlete(ach, clubId, { create: false }, transaction);
      if (!found.player) return found.reason;
      await Achievement.create({ playerId: found.player.id, clientId: ach.clientId || null, title: ach.title, year: ach.year }, { transaction });
      return 'created';
    });
  }

  res.status(200).json({
    message: skipped.length ? 'Synchronized with some items skipped.' : 'Synchronized successfully with accountability audit trail.',
    syncedIds,
    skipped,
    summary: { created, duplicates, skipped: skipped.length }
  });
});

module.exports = router;
