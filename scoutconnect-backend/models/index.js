// models/index.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('Coach', 'Scout'), allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false }
});

const Club = sequelize.define('Club', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  region: { type: DataTypes.STRING },
  contactEmail: { type: DataTypes.STRING }, // NEW: Added for Scouts to reach out
  contactPhone: { type: DataTypes.STRING }  // NEW: Added for Scouts to reach out
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
  dribblingScore: { type: DataTypes.INTEGER },
  workRate: { type: DataTypes.STRING },
  evalType: { type: DataTypes.STRING } 
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

module.exports = { sequelize, User, Club, Player, Evaluation, MatchStat, Achievement, Shortlist };