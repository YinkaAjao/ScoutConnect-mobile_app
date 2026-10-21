// models/index.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, primaryKey: true }, // Maps directly to Supabase Auth UUID
  username: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  phone: { type: DataTypes.STRING },
  role: { type: DataTypes.ENUM('Coach', 'Scout'), allowNull: false }
  // Password removed; securely handled by Supabase Auth
});

const Club = sequelize.define('Club', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  region: { type: DataTypes.STRING },
  contactEmail: { type: DataTypes.STRING },
  contactPhone: { type: DataTypes.STRING },
  isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
  standingStatus: { type: DataTypes.ENUM('Good', 'Penalized', 'Suspended'), defaultValue: 'Good' },
  trustScore: { type: DataTypes.INTEGER, defaultValue: 100 }
});

const Player = sequelize.define('Player', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  dateOfBirth: { type: DataTypes.DATEONLY, allowNull: false }, 
  position: { type: DataTypes.STRING, allowNull: false },
  profilePhoto: { type: DataTypes.STRING },
  highlightVideo: { type: DataTypes.STRING }
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
  coachSignature: { type: DataTypes.STRING }
});

const MatchStat = sequelize.define('MatchStat', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  competition: { type: DataTypes.STRING }, 
  matchDate: { type: DataTypes.DATEONLY },
  opponent: { type: DataTypes.STRING },
  matchResult: { type: DataTypes.STRING },
  minutesPlayed: { type: DataTypes.INTEGER, defaultValue: 0 },
  goals: { type: DataTypes.INTEGER, defaultValue: 0 },
  assists: { type: DataTypes.INTEGER, defaultValue: 0 },
  cleanSheet: { type: DataTypes.BOOLEAN, defaultValue: false }
});

const Achievement = sequelize.define('Achievement', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false }, 
  year: { type: DataTypes.INTEGER }
});

const Shortlist = sequelize.define('Shortlist', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  notes: { type: DataTypes.TEXT }
});

const Flag = sequelize.define('Flag', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  reporterId: { type: DataTypes.UUID, allowNull: false },
  playerId: { type: DataTypes.UUID, allowNull: false },
  reason: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('Pending', 'Resolved', 'Dismissed'), defaultValue: 'Pending' }
});

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

module.exports = { sequelize, DataTypes, User, Club, Player, Evaluation, MatchStat, Achievement, Shortlist, Flag };