// Archivio locale (SQLite). Nessun cloud.
import * as SQLite from 'expo-sqlite';
import type {
  DetectionEvent,
  EngineInput,
  EngineSnapshot,
  ParkingSession,
  QualityWarning,
  ReviewLabel,
} from '../../engine/types.ts';
import type { DetectionConfig } from '../../engine/config.ts';

export interface TestMeta {
  appVersion: string | null;
  buildNumber: string | null;
  updateId: string | null;
  runtimeVersion: string | null;
  platform: string;
  deviceModel: string | null;
  osVersion: string;
  timezone: string;
  scenarios: string[];
  permissions: { t: number; status: Record<string, string> }[];
  sensorAvailability: Record<string, unknown>;
}

export interface TestRow {
  id: string;
  startedAt: number;
  stoppedAt: number | null;
  platform: string;
  meta: TestMeta;
  config: DetectionConfig;
  quality: QualityWarning[];
  finalState: string | null;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('parcheggio.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS tests (
          id TEXT PRIMARY KEY NOT NULL,
          startedAt INTEGER NOT NULL,
          stoppedAt INTEGER,
          platform TEXT NOT NULL,
          meta TEXT NOT NULL,
          config TEXT NOT NULL,
          quality TEXT NOT NULL DEFAULT '[]',
          finalState TEXT
        );
        CREATE TABLE IF NOT EXISTS inputs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          testId TEXT NOT NULL,
          t INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS inputs_test ON inputs (testId, t);
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY NOT NULL,
          testId TEXT NOT NULL,
          t INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_test ON events (testId, t);
        CREATE TABLE IF NOT EXISTS snapshots (
          testId TEXT NOT NULL,
          t INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS snapshots_test ON snapshots (testId, t);
        CREATE TABLE IF NOT EXISTS sessions (
          parkingId TEXT PRIMARY KEY NOT NULL,
          testId TEXT NOT NULL,
          updatedAt INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS labels (
          id TEXT PRIMARY KEY NOT NULL,
          testId TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

// ---- test -------------------------------------------------------------------

function rowToTest(r: Record<string, unknown>): TestRow {
  return {
    id: r.id as string,
    startedAt: r.startedAt as number,
    stoppedAt: (r.stoppedAt as number | null) ?? null,
    platform: r.platform as string,
    meta: JSON.parse(r.meta as string),
    config: JSON.parse(r.config as string),
    quality: JSON.parse((r.quality as string) || '[]'),
    finalState: (r.finalState as string | null) ?? null,
  };
}

export async function insertTest(t: TestRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO tests (id, startedAt, stoppedAt, platform, meta, config, quality, finalState) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [t.id, t.startedAt, t.stoppedAt, t.platform, JSON.stringify(t.meta), JSON.stringify(t.config), JSON.stringify(t.quality), t.finalState],
  );
}

export async function updateTest(id: string, patch: Partial<Pick<TestRow, 'stoppedAt' | 'meta' | 'quality' | 'finalState'>>): Promise<void> {
  const db = await getDb();
  const cur = await getTest(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  await db.runAsync('UPDATE tests SET stoppedAt = ?, meta = ?, quality = ?, finalState = ? WHERE id = ?', [
    next.stoppedAt,
    JSON.stringify(next.meta),
    JSON.stringify(next.quality),
    next.finalState,
    id,
  ]);
}

export async function getTest(id: string): Promise<TestRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM tests WHERE id = ?', [id]);
  return r ? rowToTest(r) : null;
}

export async function listTests(): Promise<TestRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tests ORDER BY startedAt DESC');
  return rows.map(rowToTest);
}

export async function getActiveTest(): Promise<TestRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM tests WHERE stoppedAt IS NULL ORDER BY startedAt DESC LIMIT 1');
  return r ? rowToTest(r) : null;
}

export async function deleteTest(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const table of ['inputs', 'events', 'snapshots', 'sessions', 'labels']) {
      await db.runAsync(`DELETE FROM ${table} WHERE testId = ?`, [id]);
    }
    await db.runAsync('DELETE FROM tests WHERE id = ?', [id]);
    await db.runAsync('DELETE FROM kv WHERE key = ?', [`engine:${id}`]);
  });
}

// ---- dati del test ---------------------------------------------------------------

export async function appendInputs(testId: string, inputs: { t: number; input: EngineInput }[]): Promise<void> {
  if (inputs.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const x of inputs) {
      await db.runAsync('INSERT INTO inputs (testId, t, json) VALUES (?, ?, ?)', [testId, Math.round(x.t), JSON.stringify(x.input)]);
    }
  });
}

export async function getInputs(testId: string): Promise<EngineInput[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM inputs WHERE testId = ? ORDER BY t, id', [testId]);
  return rows.map((r) => JSON.parse(r.json));
}

export async function getLocationInputs(testId: string): Promise<EngineInput[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    `SELECT json FROM inputs WHERE testId = ? AND json LIKE '{"kind":"location"%' ORDER BY t, id`,
    [testId],
  );
  return rows.map((r) => JSON.parse(r.json));
}

export async function countInputs(testId: string): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM inputs WHERE testId = ?', [testId]);
  return r?.n ?? 0;
}

export async function appendEvents(testId: string, events: DetectionEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const e of events) {
      await db.runAsync('INSERT OR REPLACE INTO events (id, testId, t, json) VALUES (?, ?, ?, ?)', [e.id, testId, e.t, JSON.stringify(e)]);
    }
  });
}

export async function getEvents(testId?: string): Promise<DetectionEvent[]> {
  const db = await getDb();
  const rows = testId
    ? await db.getAllAsync<{ json: string }>('SELECT json FROM events WHERE testId = ? ORDER BY t', [testId])
    : await db.getAllAsync<{ json: string }>('SELECT json FROM events ORDER BY t');
  return rows.map((r) => JSON.parse(r.json));
}

export async function getEventsByTest(): Promise<Map<string, DetectionEvent[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ testId: string; json: string }>('SELECT testId, json FROM events ORDER BY t');
  const m = new Map<string, DetectionEvent[]>();
  for (const r of rows) {
    const arr = m.get(r.testId) ?? [];
    arr.push(JSON.parse(r.json));
    m.set(r.testId, arr);
  }
  return m;
}

export async function appendSnapshots(testId: string, snaps: EngineSnapshot[]): Promise<void> {
  if (snaps.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const s of snaps) await db.runAsync('INSERT INTO snapshots (testId, t, json) VALUES (?, ?, ?)', [testId, s.t, JSON.stringify(s)]);
  });
}

export async function getSnapshots(testId: string): Promise<EngineSnapshot[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM snapshots WHERE testId = ? ORDER BY t', [testId]);
  return rows.map((r) => JSON.parse(r.json));
}

export async function upsertSessions(testId: string, sessions: ParkingSession[], now: number): Promise<void> {
  if (sessions.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const s of sessions) {
      await db.runAsync('INSERT OR REPLACE INTO sessions (parkingId, testId, updatedAt, json) VALUES (?, ?, ?, ?)', [s.parkingId, testId, now, JSON.stringify(s)]);
    }
  });
}

export async function getSessions(testId?: string): Promise<(ParkingSession & { testId: string })[]> {
  const db = await getDb();
  const rows = testId
    ? await db.getAllAsync<{ testId: string; json: string }>('SELECT testId, json FROM sessions WHERE testId = ? ORDER BY updatedAt DESC', [testId])
    : await db.getAllAsync<{ testId: string; json: string }>('SELECT testId, json FROM sessions ORDER BY updatedAt DESC');
  return rows.map((r) => ({ ...JSON.parse(r.json), testId: r.testId }));
}

export async function upsertLabel(label: ReviewLabel): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO labels (id, testId, json) VALUES (?, ?, ?)', [label.id, label.testId, JSON.stringify(label)]);
}

export async function deleteLabel(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM labels WHERE id = ?', [id]);
}

export async function getLabels(testId?: string): Promise<ReviewLabel[]> {
  const db = await getDb();
  const rows = testId
    ? await db.getAllAsync<{ json: string }>('SELECT json FROM labels WHERE testId = ?', [testId])
    : await db.getAllAsync<{ json: string }>('SELECT json FROM labels');
  return rows.map((r) => JSON.parse(r.json));
}

// ---- chiave/valore ---------------------------------------------------------------

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return r?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}
