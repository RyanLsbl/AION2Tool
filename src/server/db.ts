// SQLite über das in Node eingebaute node:sqlite – kein nativer Build nötig.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

let db: DatabaseSync | null = null;

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar TEXT,
  officer INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  abo INTEGER NOT NULL DEFAULT 0,
  prefs TEXT NOT NULL DEFAULT '{}',
  legion_status TEXT,             -- NULL (kein Main) | pending | confirmed | left
  legion_seen TEXT,
  legion_checked_at INTEGER,
  legion_mismatch_at INTEGER,
  legion_confirmed_at INTEGER,
  main_set_at INTEGER,
  board_seeded INTEGER NOT NULL DEFAULT 0,
  tutorial_done_at INTEGER,       -- Einrichtungs-Assistent abgeschlossen/übersprungen
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- SHA-256 des Cookie-Werts
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS openid_nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,  -- kleingeschrieben: jeder Charakter gehört genau einem Account
  is_main INTEGER NOT NULL DEFAULT 0,
  pl_character_id TEXT,
  pl_server_id INTEGER,
  class_name TEXT,
  class_key TEXT,
  level INTEGER,
  combat_power INTEGER,
  item_level INTEGER,
  legion TEXT,
  race TEXT,
  armory_at INTEGER,
  armory_error TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = Standard der Legion
  seed_key TEXT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '✅',
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  section TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  default_on INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS board_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  off_chars TEXT NOT NULL DEFAULT '[]',
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_states (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  char_id INTEGER NOT NULL,       -- 0 = Account (server-weit)
  value REAL NOT NULL,            -- natürlicher Vorrat / Kontingent / Haken / Nutzungen
  bonus REAL NOT NULL DEFAULT 0,  -- Extra-Vorrat (Items)
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id, char_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,             -- JSON: { standard: number[], own: TaskSnapshot[] }
  uses INTEGER NOT NULL DEFAULT 0,
  promoted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  as_main INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- open | done | rejected
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_states_user ON task_states(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export function openDb(path: string): DatabaseSync {
  if (db) db.close();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate();
  return db;
}

/** Spalten, die nach Version 1.0 dazugekommen sind – werden in bestehenden Datenbanken ergänzt (nie gelöscht). */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [{ table: 'users', column: 'tutorial_done_at', definition: 'INTEGER' }];

function migrate(): void {
  for (const c of ADDED_COLUMNS) {
    const columns = all<{ name: string }>(`PRAGMA table_info(${c.table})`);
    if (!columns.some((x) => x.name === c.column)) conn().exec(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.definition}`);
  }
  run(
    "INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    String(SCHEMA_VERSION),
  );
}

export function closeDb(): void {
  db?.close();
  db = null;
}

function conn(): DatabaseSync {
  if (!db) throw new Error('Datenbank ist nicht geöffnet');
  return db;
}

type Param = SQLInputValue | boolean | undefined;
const norm = (params: Param[]): SQLInputValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return conn().prepare(sql).get(...norm(params)) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return conn().prepare(sql).all(...norm(params)) as T[];
}

export function run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
  const r = conn().prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  conn().exec('BEGIN');
  txDepth++;
  try {
    const out = fn();
    conn().exec('COMMIT');
    return out;
  } catch (e) {
    conn().exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export function log(kind: string, text: string): void {
  run('INSERT INTO log (at, kind, text) VALUES (?, ?, ?)', Date.now(), kind, text);
  run('DELETE FROM log WHERE id <= (SELECT id FROM log ORDER BY id DESC LIMIT 1 OFFSET 2000)');
}

// ---- Zeilen-Typen ----

export interface UserRow {
  id: number;
  steam_id: string;
  name: string;
  avatar: string | null;
  officer: number;
  blocked: number;
  abo: number;
  prefs: string;
  legion_status: 'pending' | 'confirmed' | 'left' | null;
  legion_seen: string | null;
  legion_checked_at: number | null;
  legion_mismatch_at: number | null;
  legion_confirmed_at: number | null;
  main_set_at: number | null;
  board_seeded: number;
  tutorial_done_at: number | null;
  created_at: number;
  last_login: number | null;
}

export interface CharacterRow {
  id: number;
  user_id: number;
  name: string;
  name_key: string;
  is_main: number;
  pl_character_id: string | null;
  pl_server_id: number | null;
  class_name: string | null;
  class_key: string | null;
  level: number | null;
  combat_power: number | null;
  item_level: number | null;
  legion: string | null;
  race: string | null;
  armory_at: number | null;
  armory_error: string | null;
  sort: number;
  created_at: number;
}

export interface TaskRow {
  id: number;
  owner_id: number | null;
  seed_key: string | null;
  name: string;
  icon: string;
  kind: string;
  scope: string;
  section: string;
  params: string;
  note: string;
  sort: number;
  active: number;
  default_on: number;
  created_at: number;
  updated_at: number;
}
