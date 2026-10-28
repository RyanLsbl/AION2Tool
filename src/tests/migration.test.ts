import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { all, closeDb, get, openDb } from '../server/db.js';

describe('Datenbank-Migration', () => {
  it('ergänzt neue Spalten in einer Datenbank aus Version 1.0, ohne Daten zu verlieren', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aion2tool-'));
    const path = join(dir, 'alt.sqlite');
    try {
      // Stand von Version 1.0: users ohne tutorial_done_at
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta VALUES ('schema', '1');
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT, steam_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT,
          officer INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, abo INTEGER NOT NULL DEFAULT 0,
          prefs TEXT NOT NULL DEFAULT '{}', legion_status TEXT, legion_seen TEXT, legion_checked_at INTEGER,
          legion_mismatch_at INTEGER, legion_confirmed_at INTEGER, main_set_at INTEGER,
          board_seeded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER
        );
        INSERT INTO users (steam_id, name, created_at) VALUES ('76561198000000009', 'Altnutzer', 1);
      `);
      old.close();

      openDb(path);
      const columns = all<{ name: string }>('PRAGMA table_info(users)').map((c) => c.name);
      assert.ok(columns.includes('tutorial_done_at'));
      assert.equal(get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema'")!.value, '2');
      assert.equal(get<{ name: string; tutorial_done_at: number | null }>('SELECT * FROM users')!.name, 'Altnutzer');
      closeDb();
      // Zweites Öffnen ändert nichts mehr
      openDb(path);
      closeDb();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
