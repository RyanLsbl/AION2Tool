// Benutzer, Sessions und Zugangsrechte.

import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_PREFS, type Access, type Character, type Me, type Prefs } from '../shared/types.js';
import { config } from './config.js';
import { all, get, run, type CharacterRow, type UserRow } from './db.js';

export const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'aion2_sid';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function upsertSteamUser(steamId: string, profile: { name: string; avatar: string | null } | null): UserRow {
  const now = Date.now();
  const existing = get<UserRow>('SELECT * FROM users WHERE steam_id = ?', steamId);
  if (existing) {
    if (profile) run('UPDATE users SET name = ?, avatar = ?, last_login = ? WHERE id = ?', profile.name, profile.avatar, now, existing.id);
    else run('UPDATE users SET last_login = ? WHERE id = ?', now, existing.id);
  } else {
    run(
      'INSERT INTO users (steam_id, name, avatar, created_at, last_login) VALUES (?, ?, ?, ?, ?)',
      steamId, profile?.name ?? `Steam-User …${steamId.slice(-4)}`, profile?.avatar ?? null, now, now,
    );
  }
  return get<UserRow>('SELECT * FROM users WHERE steam_id = ?', steamId)!;
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', hash(token), userId, now, now + SESSION_DAYS * 86_400_000);
  return token;
}

export function userForSession(token: string | undefined): UserRow | null {
  if (!token || token.length > 100) return null;
  const row = get<UserRow & { expires_at: number }>(
    'SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
    hash(token),
  );
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

export function deleteSession(token: string | undefined): void {
  if (token) run('DELETE FROM sessions WHERE id = ?', hash(token));
}

export function cleanupSessions(): void {
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}

export function isOwner(u: UserRow): boolean {
  return config.ownerSteamIds.includes(u.steam_id);
}

export function isOfficer(u: UserRow): boolean {
  return isOwner(u) || !!u.officer;
}

export function accessOf(u: UserRow): Access {
  if (isOwner(u)) return 'ok';
  if (u.blocked) return 'blocked';
  if (!config.legionCheck) return mainOf(u.id) ? 'ok' : 'needs-main';
  if (!u.legion_status || !mainOf(u.id)) return 'needs-main';
  if (u.legion_status === 'confirmed') return 'ok';
  return u.legion_status;
}

export function prefsOf(u: UserRow): Prefs {
  try {
    const p = JSON.parse(u.prefs) as Partial<Prefs>;
    const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 168 ? v : d);
    return {
      warnRegenHours: n(p.warnRegenHours, DEFAULT_PREFS.warnRegenHours),
      warnDailyHours: n(p.warnDailyHours, DEFAULT_PREFS.warnDailyHours),
      warnWeeklyHours: n(p.warnWeeklyHours, DEFAULT_PREFS.warnWeeklyHours),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function charactersOf(userId: number): CharacterRow[] {
  return all<CharacterRow>('SELECT * FROM characters WHERE user_id = ? ORDER BY is_main DESC, sort, id', userId);
}

export function mainOf(userId: number): CharacterRow | undefined {
  return get<CharacterRow>('SELECT * FROM characters WHERE user_id = ? AND is_main = 1', userId);
}

export function toCharacter(c: CharacterRow): Character {
  return {
    id: c.id,
    name: c.name,
    isMain: !!c.is_main,
    className: c.class_name,
    classKey: c.class_key,
    level: c.level,
    combatPower: c.combat_power,
    itemLevel: c.item_level,
    legion: c.legion,
    race: c.race,
    armoryAt: c.armory_at,
    armoryError: c.armory_error,
    sort: c.sort,
  };
}

export function toMe(u: UserRow): Me {
  return {
    id: u.id,
    steamId: u.steam_id,
    name: u.name,
    avatar: u.avatar,
    isOfficer: isOfficer(u),
    isOwner: isOwner(u),
    abo: !!u.abo,
    prefs: prefsOf(u),
    access: accessOf(u),
    tutorialDone: !!u.tutorial_done_at,
    legionSeen: u.legion_seen,
    legionCheckedAt: u.legion_checked_at,
    characters: charactersOf(u.id).map(toCharacter),
  };
}

export function userById(id: number): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}
