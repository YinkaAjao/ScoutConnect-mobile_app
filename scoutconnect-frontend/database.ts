// database.ts
import * as SQLite from 'expo-sqlite';
import { supabase } from './src/lib/supabase';
import { newClientId } from './src/lib/text';

const db = SQLite.openDatabaseSync('scoutconnect_offline.db');

type SyncTable = 'OfflineEvaluations' | 'OfflineMatchStats' | 'OfflineAchievements';
const SYNC_TABLES: SyncTable[] = ['OfflineEvaluations', 'OfflineMatchStats', 'OfflineAchievements'];

/** The signed-in user's id, read from the locally stored session (works offline); null when signed out. */
const currentUserId = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
};

const requireUserId = async (): Promise<string> => {
  const id = await currentUserId();
  if (!id) throw new Error('Your session has expired. Please sign in again before saving.');
  return id;
};

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

  // Safe migrations for devices that already created these tables; a duplicate-column error just means it exists.
  const alterColumns = [
    `ALTER TABLE OfflineEvaluations ADD COLUMN position TEXT DEFAULT 'Forward';`,
    `ALTER TABLE OfflineEvaluations ADD COLUMN checklistJson TEXT;`,
    `ALTER TABLE OfflineEvaluations ADD COLUMN currentStage INTEGER DEFAULT 1;`,
    `ALTER TABLE OfflineEvaluations ADD COLUMN isDraft INTEGER DEFAULT 0;`,
    ...SYNC_TABLES.flatMap((table) => [
      `ALTER TABLE ${table} ADD COLUMN userId TEXT;`,     // owner of the record, so accounts on one phone never mix
      `ALTER TABLE ${table} ADD COLUMN clientId TEXT;`,   // lets the server ignore a record it already stored
      `ALTER TABLE ${table} ADD COLUMN playerId TEXT;`,   // server id of the athlete (survives renames)
    ]),
  ];
  for (const query of alterColumns) {
    try {
      await db.execAsync(query);
    } catch (e) {
      // Column already exists, safe to ignore
    }
  }

  // Give pre-existing rows a unique clientId, and hand them to the user who is signed in right now.
  const deviceTag = Math.random().toString(36).slice(2, 10);
  const userId = await currentUserId();
  for (const table of SYNC_TABLES) {
    await db.runAsync(`UPDATE ${table} SET clientId = 'legacy-' || ? || '-' || id WHERE clientId IS NULL`, [deviceTag]);
    if (userId) await db.runAsync(`UPDATE ${table} SET userId = ? WHERE userId IS NULL`, [userId]);
  }
};

// --- SAVE & UPDATE EVALUATION FUNCTIONS (SUPPORTS STAGED DRAFTS) ---
export const saveEvaluationLocally = async (
  playerName: string,
  dateOfBirth: string,
  profilePhoto: string | null,
  sprintSpeed: number | null,
  dribblingScore: number | null,
  workRate: string,
  evalType: string,
  position: string = 'Forward',
  checklistJson: string | null = null,
  currentStage: number = 1,
  isDraft: number = 0,
  existingDraftId: number | null = null,
  playerId: string | null = null
): Promise<number> => {
  const userId = await requireUserId();
  const timestamp = new Date().toISOString();

  if (existingDraftId) {
    await db.runAsync(
      `UPDATE OfflineEvaluations
       SET playerName = ?, dateOfBirth = ?, position = ?, profilePhoto = ?, sprintSpeed = ?, dribblingScore = ?, workRate = ?, evalType = ?, checklistJson = ?, currentStage = ?, isDraft = ?, timestamp = ?, playerId = ?
       WHERE id = ? AND userId = ?`,
      [playerName, dateOfBirth, position, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, checklistJson, currentStage, isDraft, timestamp, playerId, existingDraftId, userId]
    );
    return existingDraftId;
  }

  const result = await db.runAsync(
    `INSERT INTO OfflineEvaluations (playerName, dateOfBirth, position, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, checklistJson, currentStage, isDraft, timestamp, synced, userId, clientId, playerId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [playerName, dateOfBirth, position, profilePhoto, sprintSpeed, dribblingScore, workRate, evalType, checklistJson, currentStage, isDraft, timestamp, userId, newClientId(userId), playerId]
  );
  return result.lastInsertRowId;
};

export const deleteEvaluationDraft = async (id: number): Promise<void> => {
  const userId = await requireUserId();
  await db.runAsync(`DELETE FROM OfflineEvaluations WHERE id = ? AND userId = ?`, [id, userId]);
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
  minutesPlayed: number,
  playerId: string | null = null
): Promise<void> => {
  const userId = await requireUserId();
  await db.runAsync(
    `INSERT INTO OfflineMatchStats (playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed, userId, clientId, playerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerName, dateOfBirth, competition, matchDate, opponent, matchResult, goals, assists, minutesPlayed, userId, newClientId(userId), playerId]
  );
};

export const saveAchievementLocally = async (
  playerName: string,
  dateOfBirth: string,
  title: string,
  year: number,
  playerId: string | null = null
): Promise<void> => {
  const userId = await requireUserId();
  await db.runAsync(
    `INSERT INTO OfflineAchievements (playerName, dateOfBirth, title, year, userId, clientId, playerId) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [playerName, dateOfBirth, title, year, userId, newClientId(userId), playerId]
  );
};

// --- FETCH DRAFTS & UNSYNCED FUNCTIONS (always limited to the signed-in user) ---
const forUser = async (sql: string): Promise<any[]> => {
  const userId = await currentUserId();
  return userId ? await db.getAllAsync(sql, [userId]) : [];
};

export const getDraftEvaluations = async (): Promise<any[]> =>
  forUser(`SELECT * FROM OfflineEvaluations WHERE isDraft = 1 AND synced = 0 AND userId = ? ORDER BY timestamp DESC;`);

export const getUnsyncedEvaluations = async (): Promise<any[]> =>
  forUser(`SELECT * FROM OfflineEvaluations WHERE isDraft = 0 AND synced = 0 AND userId = ? ORDER BY timestamp DESC;`);

export const getUnsyncedMatchStats = async (): Promise<any[]> =>
  forUser(`SELECT * FROM OfflineMatchStats WHERE synced = 0 AND userId = ?;`);

export const getUnsyncedAchievements = async (): Promise<any[]> =>
  forUser(`SELECT * FROM OfflineAchievements WHERE synced = 0 AND userId = ?;`);

// --- SYNC UPDATE FUNCTIONS ---
const markSynced = async (table: SyncTable, ids: number[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE ${table} SET synced = 1 WHERE id IN (${placeholders})`, ids);
};

export const markEvaluationsAsSynced = (ids: number[]) => markSynced('OfflineEvaluations', ids);
export const markMatchStatsAsSynced = (ids: number[]) => markSynced('OfflineMatchStats', ids);
export const markAchievementsAsSynced = (ids: number[]) => markSynced('OfflineAchievements', ids);

/** Permanently deletes unsyncable items the coach chose to discard (e.g. their athlete no longer exists). */
export const discardLocalItems = async (type: 'records' | 'matchStats' | 'achievements', ids: number[]): Promise<void> => {
  if (ids.length === 0) return;
  const userId = await requireUserId();
  const table: SyncTable = { records: 'OfflineEvaluations', matchStats: 'OfflineMatchStats', achievements: 'OfflineAchievements' }[type] as SyncTable;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM ${table} WHERE userId = ? AND id IN (${placeholders})`, [userId, ...ids]);
};
