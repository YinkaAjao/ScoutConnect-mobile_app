import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('scoutconnect_offline.db');

export const initDB = async () => {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS OfflineEvaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerName TEXT NOT NULL,
      dateOfBirth TEXT NOT NULL,
      profilePhoto TEXT,     -- NEW: Stores the local image URI before syncing
      sprintSpeed REAL,
      dribblingScore INTEGER,
      workRate TEXT,
      evalType TEXT,
      timestamp TEXT,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS OfflineMatchStats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opponent TEXT,
      matchResult TEXT,
      playerName TEXT NOT NULL,
      dateOfBirth TEXT NOT NULL,
      competition TEXT,
      matchDate TEXT,
      goals INTEGER,
      assists INTEGER,
      minutesPlayed INTEGER,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS OfflineAchievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerName TEXT NOT NULL,
      dateOfBirth TEXT NOT NULL,
      title TEXT,
      year INTEGER,
      synced INTEGER DEFAULT 0
    );
  `);
};

// --- SAVE FUNCTIONS ---
export const saveEvaluationLocally = async (playerName, dateOfBirth, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType) => {
  const timestamp = new Date().toISOString(); // Needed for Backend Conflict Resolution
  await db.runAsync(
    `INSERT INTO OfflineEvaluations (playerName, dateOfBirth, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerName, dateOfBirth, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, timestamp]
  );
};

export const saveMatchStatLocally = async (playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed) => {
  await db.runAsync(
    `INSERT INTO OfflineMatchStats (playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed]
  );
};

export const saveAchievementLocally = async (playerName, dateOfBirth, title, year) => {
  await db.runAsync(
    `INSERT INTO OfflineAchievements (playerName, dateOfBirth, title, year) VALUES (?, ?, ?, ?)`,
    [playerName, dateOfBirth, title, year]
  );
};

// --- FETCH UNSYNCED FUNCTIONS ---
export const getUnsyncedEvaluations = async () => await db.getAllAsync(`SELECT * FROM OfflineEvaluations WHERE synced = 0;`);
export const getUnsyncedMatchStats = async () => await db.getAllAsync(`SELECT * FROM OfflineMatchStats WHERE synced = 0;`);
export const getUnsyncedAchievements = async () => await db.getAllAsync(`SELECT * FROM OfflineAchievements WHERE synced = 0;`);

// --- SYNC UPDATE FUNCTIONS ---
export const markEvaluationsAsSynced = async (ids) => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE OfflineEvaluations SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const markMatchStatsAsSynced = async (ids) => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE OfflineMatchStats SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const markAchievementsAsSynced = async (ids) => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE OfflineAchievements SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};