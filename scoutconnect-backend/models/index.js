// models/index.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, primaryKey: true }, // Maps directly to Supabase Auth UUID
  username: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  phone: { type: DataTypes.STRING },
  role: { type: DataTypes.ENUM('Coach', 'Scout'), allowNull: false },
  // Defaults keep every pre-existing coach as an active owner; joiners are set to Member/Pending explicitly.
  clubRole: { type: DataTypes.STRING, defaultValue: 'Owner' }, // 'Owner' | 'Member'
  membershipStatus: { type: DataTypes.STRING, defaultValue: 'Active' } // 'Active' | 'Pending' | 'Rejected'
  // Password removed; securely handled by Supabase Auth
});

const Club = sequelize.define('Club', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  region: { type: DataTypes.STRING },
  contactEmail: { type: DataTypes.STRING },
  contactPhone: { type: DataTypes.STRING },
  entityType: { type: DataTypes.STRING }, // e.g. 'Grassroots Academy'; see ENTITY_TYPES in server.js
  isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
  standingStatus: { type: DataTypes.ENUM('Good', 'Penalized', 'Suspended'), defaultValue: 'Good' },
  trustScore: { type: DataTypes.INTEGER, defaultValue: 100 },
  // Verification review. `isVerified` stays the flag the rest of the app reads; these record how it got there.
  verificationStatus: { type: DataTypes.STRING, defaultValue: 'Unverified' }, // Unverified | Submitted | Verified | Rejected
  verificationStatement: { type: DataTypes.TEXT },
  verificationSubmittedAt: { type: DataTypes.DATE },
  verifiedAt: { type: DataTypes.DATE },
  verifiedBy: { type: DataTypes.STRING }, // admin's Supabase user id
  verificationRejectionReason: { type: DataTypes.TEXT }
});

const Player = sequelize.define('Player', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  dateOfBirth: { type: DataTypes.DATEONLY, allowNull: false }, 
  position: { type: DataTypes.STRING, allowNull: false },
  profilePhoto: { type: DataTypes.STRING },
  highlightVideo: { type: DataTypes.STRING },
  // Scouts only see an athlete once a guardian's consent is recorded. NULL = existed before this rule, covered by a grace period.
  consentStatus: { type: DataTypes.STRING }, // 'Recorded' | 'Missing' | NULL (legacy)
  consentGuardian: { type: DataTypes.STRING },
  consentRecordedAt: { type: DataTypes.DATE },
  consentRecordedBy: { type: DataTypes.STRING },
  consentGraceUntil: { type: DataTypes.DATE },
  scoutHidden: { type: DataTypes.BOOLEAN },
  scoutHiddenReason: { type: DataTypes.STRING }
});

const Evaluation = sequelize.define('Evaluation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sprintSpeed: { type: DataTypes.FLOAT },
  dribblingScore: { type: DataTypes.FLOAT },
  workRate: { type: DataTypes.TEXT },
  evalType: { type: DataTypes.STRING },
  evaluatorName: { type: DataTypes.STRING },
  evaluationDate: { type: DataTypes.STRING },
  overallRating: { type: DataTypes.INTEGER },
  strengths: { type: DataTypes.TEXT },
  areasForImprovement: { type: DataTypes.TEXT },
  checklistData: { type: DataTypes.JSONB },
  coachSignature: { type: DataTypes.STRING },
  clientId: { type: DataTypes.STRING } // device-generated id; makes re-sent sync records idempotent
}, { indexes: [{ unique: true, fields: ['clientId'] }] });

const MatchStat = sequelize.define('MatchStat', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  competition: { type: DataTypes.STRING }, 
  matchDate: { type: DataTypes.DATEONLY },
  opponent: { type: DataTypes.STRING },
  matchResult: { type: DataTypes.STRING },
  minutesPlayed: { type: DataTypes.INTEGER, defaultValue: 0 },
  goals: { type: DataTypes.INTEGER, defaultValue: 0 },
  assists: { type: DataTypes.INTEGER, defaultValue: 0 },
  cleanSheet: { type: DataTypes.BOOLEAN, defaultValue: false },
  clientId: { type: DataTypes.STRING }
}, { indexes: [{ unique: true, fields: ['clientId'] }] });

const Achievement = sequelize.define('Achievement', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false }, 
  year: { type: DataTypes.INTEGER },
  clientId: { type: DataTypes.STRING }
}, { indexes: [{ unique: true, fields: ['clientId'] }] });

const Shortlist = sequelize.define('Shortlist', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  notes: { type: DataTypes.TEXT }
});

const Flag = sequelize.define('Flag', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  reporterId: { type: DataTypes.UUID, allowNull: false },
  playerId: { type: DataTypes.UUID, allowNull: false },
  reason: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('Pending', 'Resolved', 'Dismissed'), defaultValue: 'Pending' },
  category: { type: DataTypes.STRING },
  resolutionNote: { type: DataTypes.TEXT },
  resolvedBy: { type: DataTypes.STRING },
  resolvedAt: { type: DataTypes.DATE }
});

const VerificationDocument = sequelize.define('VerificationDocument', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  clubId: { type: DataTypes.UUID }, // set for club verification
  scoutUserId: { type: DataTypes.STRING }, // set for scout accreditation
  docType: { type: DataTypes.STRING, allowNull: false },
  storagePath: { type: DataTypes.STRING, allowNull: false }, // path inside the private verification-docs bucket
  fileName: { type: DataTypes.STRING },
  uploadedBy: { type: DataTypes.STRING }
});

// Append-only audit trail of every verification decision.
const VerificationEvent = sequelize.define('VerificationEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  clubId: { type: DataTypes.UUID },
  scoutUserId: { type: DataTypes.STRING },
  actorId: { type: DataTypes.STRING },
  action: { type: DataTypes.STRING, allowNull: false }, // Submitted | Verified | Rejected | Revoked | Reset (clubs); Submitted | Approved | Rejected | Suspended | Reinstated (scouts)
  note: { type: DataTypes.TEXT }
});

// A scout must be accredited before seeing any athlete data. No row = never applied.
const ScoutProfile = sequelize.define('ScoutProfile', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  organisation: { type: DataTypes.STRING },
  orgType: { type: DataTypes.STRING },
  licenceNumber: { type: DataTypes.STRING },
  statement: { type: DataTypes.TEXT },
  status: { type: DataTypes.STRING, defaultValue: 'Pending' }, // Pending | Submitted | Approved | Rejected | Suspended
  submittedAt: { type: DataTypes.DATE },
  decidedAt: { type: DataTypes.DATE },
  decidedBy: { type: DataTypes.STRING },
  rejectionReason: { type: DataTypes.TEXT }
}, { indexes: [{ unique: true, fields: ['userId'] }] });

// A scout asks a club to release an athlete's identity and the club's contact details.
const ContactRequest = sequelize.define('ContactRequest', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  scoutId: { type: DataTypes.UUID, allowNull: false },
  playerId: { type: DataTypes.UUID, allowNull: false },
  clubId: { type: DataTypes.UUID, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'Pending' }, // Pending | Accepted | Declined
  responseNote: { type: DataTypes.TEXT },
  respondedBy: { type: DataTypes.STRING },
  respondedAt: { type: DataTypes.DATE }
});

// One row per scout search, so unusual browsing (scraping) can be spotted. Prune old rows regularly.
const ScoutAccessLog = sequelize.define('ScoutAccessLog', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  scoutId: { type: DataTypes.UUID, allowNull: false },
  route: { type: DataTypes.STRING },
  resultCount: { type: DataTypes.INTEGER },
  athleteIds: { type: DataTypes.JSONB }
}, { indexes: [{ fields: ['scoutId', 'createdAt'] }, { fields: ['createdAt'] }] });

// --- RELATIONSHIPS ---
Club.hasMany(User, { foreignKey: 'clubId' });
User.belongsTo(Club, { foreignKey: 'clubId' });
Club.hasMany(Player, { foreignKey: 'currentClubId' });
Player.belongsTo(Club, { foreignKey: 'currentClubId' });
Player.hasMany(Evaluation, { foreignKey: 'playerId' });
Evaluation.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(MatchStat, { foreignKey: 'playerId' });
MatchStat.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(Achievement, { foreignKey: 'playerId' });
Achievement.belongsTo(Player, { foreignKey: 'playerId' });
User.hasMany(Shortlist, { foreignKey: 'scoutId' });
Shortlist.belongsTo(User, { foreignKey: 'scoutId' });
Player.hasMany(Shortlist, { foreignKey: 'playerId' });
Shortlist.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(Flag, { foreignKey: 'playerId' });
Flag.belongsTo(Player, { foreignKey: 'playerId' });
User.hasMany(Flag, { foreignKey: 'reporterId' });
Flag.belongsTo(User, { foreignKey: 'reporterId' });
Club.hasMany(VerificationDocument, { foreignKey: 'clubId' });
VerificationDocument.belongsTo(Club, { foreignKey: 'clubId' });
Club.hasMany(VerificationEvent, { foreignKey: 'clubId' });
VerificationEvent.belongsTo(Club, { foreignKey: 'clubId' });
User.hasOne(ScoutProfile, { foreignKey: 'userId' });
ScoutProfile.belongsTo(User, { foreignKey: 'userId' });
ContactRequest.belongsTo(User, { as: 'Scout', foreignKey: 'scoutId' });
ContactRequest.belongsTo(Player, { foreignKey: 'playerId' });
ContactRequest.belongsTo(Club, { foreignKey: 'clubId' });

module.exports = { sequelize, DataTypes, User, Club, Player, Evaluation, MatchStat, Achievement, Shortlist, Flag, VerificationDocument, VerificationEvent, ScoutProfile, ContactRequest, ScoutAccessLog };