// services/scoutData.js
// Shared pieces of the scout-facing responses (minimised athlete views, signed photos, the access log).
const { Op } = require('sequelize');
const { ContactRequest, ScoutAccessLog } = require('../models');

// Columns a scout may be sent; everything else on these tables stays on the server.

const SCOUT_PLAYER_ATTRIBUTES = ['id', 'name', 'dateOfBirth', 'position', 'profilePhoto', 'currentClubId', 'consentStatus', 'consentGraceUntil', 'scoutHidden'];
const SCOUT_EVALUATION_ATTRIBUTES = ['id', 'createdAt', 'evalType', 'sprintSpeed', 'dribblingScore', 'overallRating', 'checklistData'];
const SCOUT_CLUB_ATTRIBUTES = ['id', 'name', 'isVerified', 'standingStatus', 'trustScore', 'contactEmail', 'contactPhone'];

/** The newest contact request this scout made for each of the given athletes. */
async function latestRequestsFor(scoutId, playerIds) {
  const latest = new Map();
  if (playerIds.length === 0) return latest;
  const requests = await ContactRequest.findAll({
    where: { scoutId, playerId: { [Op.in]: playerIds } },
    order: [['createdAt', 'DESC']]
  });
  for (const request of requests) if (!latest.has(request.playerId)) latest.set(request.playerId, request);
  return latest;
}

/** Signed photo links for a batch of rows (stored photo value -> link). */
const signedPhotos = (req, rows) => req.app.locals.photos.sign(rows.map((row) => row.profilePhoto));

/** One row per scout search, so unusual browsing can be spotted later. Best effort: it never fails the request. */
async function logScoutAccess(scoutId, route, athleteIds) {
  try {
    await ScoutAccessLog.create({ scoutId, route, resultCount: athleteIds.length, athleteIds: athleteIds.slice(0, 50) });
  } catch (error) {
    console.error('Could not write the scout access log:', error.message);
  }
}

module.exports = {
  SCOUT_PLAYER_ATTRIBUTES, SCOUT_EVALUATION_ATTRIBUTES, SCOUT_CLUB_ATTRIBUTES,
  latestRequestsFor, signedPhotos, logScoutAccess
};
