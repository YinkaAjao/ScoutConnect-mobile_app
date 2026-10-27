// database.ts
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('scoutconnect_offline.db');

export const initDB = async (): Promise<void> => {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS OfflineEvaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerName TEXT NOT NULL,
      dateOfBirth TEXT NOT NULL,
      position TEXT DEFAULT 'Forward',
      profilePhoto TEXT,
      sprintSpeed REAL,
      dribblingScore REAL,
      workRate TEXT,
      evalType TEXT,
      checklistJson TEXT,
      currentStage INTEGER DEFAULT 1,
      isDraft INTEGER DEFAULT 0,
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

  // Safe migration for devices that already initialized OfflineEvaluations previously
  const alterColumns = [
    `ALTER TABLE OfflineEvaluations ADD COLUMN position TEXT DEFAULT 'Forward';`,
    `ALTER TABLE OfflineEvaluations ADD COLUMN checklistJson TEXT;`,
    `ALTER TABLE OfflineEvaluations ADD COLUMN currentStage INTEGER DEFAULT 1;`,
    `ALTER TABLE OfflineEvaluations ADD COLUMN isDraft INTEGER DEFAULT 0;`
  ];

  for (const query of alterColumns) {
    try {
      await db.execAsync(query);
    } catch (e) {
      // Column already exists, safe to ignore
    }
  }
};

// --- SAVE & UPDATE EVALUATION FUNCTIONS (SUPPORTS STAGED DRAFTS) ---
export const saveEvaluationLocally = async (
  playerName: string,
  dateOfBirth: string,
  profilePhoto: string | null,
  sprintSpeed: number,
  dribblingScore: number,
  workRate: string,
  evalType: string,
  position: string = 'Forward',
  checklistJson: string | null = null,
  currentStage: number = 1,
  isDraft: number = 0,
  existingDraftId: number | null = null
): Promise<number> => {
  const timestamp = new Date().toISOString();

  if (existingDraftId) {
    await db.runAsync(
      `UPDATE OfflineEvaluations 
       SET playerName = ?, dateOfBirth = ?, position = ?, profilePhoto = ?, sprintSpeed = ?, dribblingScore = ?, workRate = ?, evalType = ?, checklistJson = ?, currentStage = ?, isDraft = ?, timestamp = ?
       WHERE id = ?`,
      [playerName, dateOfBirth, position, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, checklistJson, currentStage, isDraft, timestamp, existingDraftId]
    );
    return existingDraftId;
  } else {
    const result = await db.runAsync(
      `INSERT INTO OfflineEvaluations (playerName, dateOfBirth, position, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, checklistJson, currentStage, isDraft, timestamp, synced) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [playerName, dateOfBirth, position, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, checklistJson, currentStage, isDraft, timestamp]
    );
    return result.lastInsertRowId;
  }
};

export const deleteEvaluationDraft = async (id: number): Promise<void> => {
  await db.runAsync(`DELETE FROM OfflineEvaluations WHERE id = ?`, [id]);
};

export const saveMatchStatLocally = async (
  playerName: string, 
  dateOfBirth: string, 
  competition: string, 
  matchDate: string, 
  opponent: string, 
  matchResult: string, 
  goals: number, 
  assists: number, 
  minutesPlayed: number
): Promise<void> => {
  await db.runAsync(
    `INSERT INTO OfflineMatchStats (playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed]
  );
};

export const saveAchievementLocally = async (
  playerName: string, 
  dateOfBirth: string, 
  title: string, 
  year: number
): Promise<void> => {
  await db.runAsync(
    `INSERT INTO OfflineAchievements (playerName, dateOfBirth, title, year) VALUES (?, ?, ?, ?)`,
    [playerName, dateOfBirth, title, year]
  );
};

// --- FETCH DRAFTS & UNSYNCED FUNCTIONS ---
export const getDraftEvaluations = async (): Promise<any[]> =>
  await db.getAllAsync(`SELECT * FROM OfflineEvaluations WHERE isDraft = 1 AND synced = 0 ORDER BY timestamp DESC;`);

export const getUnsyncedEvaluations = async (): Promise<any[]> =>
  await db.getAllAsync(`SELECT * FROM OfflineEvaluations WHERE isDraft = 0 AND synced = 0 ORDER BY timestamp DESC;`);

export const getUnsyncedMatchStats = async (): Promise<any[]> =>
  await db.getAllAsync(`SELECT * FROM OfflineMatchStats WHERE synced = 0;`);

export const getUnsyncedAchievements = async (): Promise<any[]> =>
  await db.getAllAsync(`SELECT * FROM OfflineAchievements WHERE synced = 0;`);

// --- SYNC UPDATE FUNCTIONS ---
export const markEvaluationsAsSynced = async (ids: number[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE OfflineEvaluations SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const markMatchStatsAsSynced = async (ids: number[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE OfflineMatchStats SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const markAchievementsAsSynced = async (ids: number[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE OfflineAchievements SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};