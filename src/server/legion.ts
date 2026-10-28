// Charaktere anlegen/aktualisieren und Legions-Prüfung des Mains.
//
// Regeln (wie im Legions-Bot):
// - Zugang hat, wessen Main laut PlayNC in der Legion ist (Feld regionName).
// - Neuer Main nicht (noch nicht) in der Legion → „pending“, Nachprüfung 2 Std. lang alle 10 Min., danach 3 Tage stündlich.
// - Bestätigtes Mitglied nicht mehr in der Legion → erst wenn zwei Prüfungen im Abstand von mind. 1 Std. das zeigen → „left“.
// - Offiziere/Haupt-Admins werden nie automatisch ausgesperrt, nur protokolliert.
// - Notbremse: Stehen gleichzeitig viele bestätigte Mitglieder nicht in der Legion (PlayNC-Fehler?), wird niemand ausgesperrt.

import { config } from './config.js';
import { all, get, log, run, tx, type CharacterRow, type UserRow } from './db.js';
import { fetchCharacter, lookupCharacter, sameLegion, type CharacterRef, type PlayncCharacter } from './plaync.js';
import { charactersOf, isOfficer, mainOf, nameKey, userById } from './users.js';

export const MAX_CHARACTERS = 8;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NEW_FAST_WINDOW = 2 * HOUR;
const NEW_SLOW_WINDOW = 3 * 24 * HOUR;
export const MISMATCH_RECHECK = HOUR;

export class UserError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export function validCharacterName(name: string): boolean {
  return /^[\p{L}\p{N}]{2,16}$/u.test(name.trim());
}

function saveResult(charId: number, r: PlayncCharacter): void {
  run(
    `UPDATE characters SET name = ?, class_name = COALESCE(?, class_name), class_key = COALESCE(?, class_key), level = COALESCE(?, level),
     combat_power = COALESCE(?, combat_power), item_level = COALESCE(?, item_level), legion = ?, race = COALESCE(?, race),
     pl_character_id = ?, pl_server_id = ?, armory_at = ?, armory_error = NULL WHERE id = ?`,
    r.name, r.className ?? null, r.classKey ?? null, r.level ?? null, r.combatPower ?? null, r.itemLevel ?? null,
    r.legion ?? null, r.race ?? null, r.ref.characterId, r.ref.serverId, Date.now(), charId,
  );
}

/** Wertet die Legion des Mains aus (nach jeder PlayNC-Abfrage des Mains). */
export function applyLegion(u: UserRow, seen: string | null, now = Date.now()): void {
  const inLegion = sameLegion(seen, config.aion.legion);
  run('UPDATE users SET legion_seen = ?, legion_checked_at = ? WHERE id = ?', seen, now, u.id);
  const who = `${u.name} (Main ${mainOf(u.id)?.name ?? '?'})`;
  const seenText = seen ? `Legion „${seen}“` : 'keine Legion';

  if (inLegion) {
    if (u.legion_status !== 'confirmed') {
      run('UPDATE users SET legion_status = ?, legion_confirmed_at = ?, legion_mismatch_at = NULL WHERE id = ?', 'confirmed', now, u.id);
      log('legion', u.legion_status === 'left' ? `↩️ ${who} ist wieder in ${config.aion.legion} – Zugang wieder frei.` : `✅ ${who} bestätigt.`);
    } else if (u.legion_mismatch_at) {
      run('UPDATE users SET legion_mismatch_at = NULL WHERE id = ?', u.id);
    }
    return;
  }

  if (!u.legion_status) {
    run("UPDATE users SET legion_status = 'pending' WHERE id = ?", u.id);
    log('legion', `⏳ ${who}: laut PlayNC ${seenText} – wartet auf Bestätigung.`);
    return;
  }
  if (u.legion_status !== 'confirmed') return;

  if (!u.legion_mismatch_at) {
    run('UPDATE users SET legion_mismatch_at = ? WHERE id = ?', now, u.id);
    return;
  }
  if (now - u.legion_mismatch_at < MISMATCH_RECHECK) return;

  const confirmed = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE legion_status = 'confirmed'")?.n ?? 0;
  const mismatching = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE legion_status = 'confirmed' AND legion_mismatch_at IS NOT NULL")?.n ?? 0;
  const threshold = confirmed >= 10 ? Math.max(3, Math.ceil(confirmed * 0.2)) : 3;
  if (mismatching >= threshold) {
    log('error', `🛑 Notbremse: ${mismatching} von ${confirmed} bestätigten Mitgliedern stehen laut PlayNC nicht in „${config.aion.legion}“ – niemand wird ausgesperrt.`);
    return;
  }
  if (isOfficer(u)) {
    log('legion', `ℹ️ ${who} steht laut PlayNC nicht mehr in ${config.aion.legion} (${seenText}). Offiziere werden nicht ausgesperrt.`);
    run('UPDATE users SET legion_mismatch_at = NULL WHERE id = ?', u.id);
    return;
  }
  run("UPDATE users SET legion_status = 'left', legion_mismatch_at = NULL WHERE id = ?", u.id);
  log('legion', `🚪 ${who} ist laut PlayNC nicht mehr in ${config.aion.legion} (${seenText}, zweimal geprüft) – Zugang gesperrt.`);
}

async function lookupOrFail(name: string): Promise<PlayncCharacter> {
  let r: PlayncCharacter | null;
  try {
    r = await lookupCharacter(name, true);
  } catch (e) {
    throw new UserError(`PlayNC ist gerade nicht erreichbar (${e instanceof Error ? e.message : e}). Bitte später erneut versuchen.`, 503, 'plaync');
  }
  if (!r) throw new UserError(`„${name}“ wurde auf ${config.aion.server} nicht gefunden. Stimmt die Schreibweise?`, 404, 'notfound');
  return r;
}

/** Legt einen Charakter an. Der erste Charakter (oder asMain) wird Main und löst die Legions-Prüfung aus. */
export async function addCharacter(u: UserRow, rawName: string, asMain: boolean): Promise<CharacterRow> {
  const name = rawName.trim();
  if (!validCharacterName(name)) throw new UserError('Bitte einen gültigen Charakternamen eingeben (2–16 Buchstaben/Ziffern).');
  const owner = get<CharacterRow>('SELECT * FROM characters WHERE name_key = ?', nameKey(name));
  if (owner?.user_id === u.id) throw new UserError(`„${owner.name}“ ist bereits bei dir eingetragen.`, 409);
  if (owner) throw new UserError(`„${owner.name}“ ist bereits einem anderen Account zugeordnet.`, 409, 'claimed');
  const existing = charactersOf(u.id);
  if (existing.length >= MAX_CHARACTERS) throw new UserError(`Höchstens ${MAX_CHARACTERS} Charaktere pro Account.`);
  const makeMain = asMain || !existing.some((c) => c.is_main);

  let r: PlayncCharacter | null = null;
  try {
    r = await lookupOrFail(name);
  } catch (e) {
    // Twinks dürfen ohne PlayNC-Daten angelegt werden, wenn nur PlayNC nicht erreichbar ist
    if (!(e instanceof UserError && e.code === 'plaync' && (!makeMain || !config.legionCheck))) throw e;
  }
  const finalName = r?.name ?? name;
  // Nach der Abfrage erneut prüfen (der Name kann sich in der Schreibweise unterscheiden)
  if (get('SELECT 1 FROM characters WHERE name_key = ?', nameKey(finalName))) {
    throw new UserError(`„${finalName}“ ist bereits einem Account zugeordnet.`, 409, 'claimed');
  }

  const now = Date.now();
  const charId = tx(() => {
    if (makeMain) run('UPDATE characters SET is_main = 0 WHERE user_id = ?', u.id);
    const id = run(
      `INSERT INTO characters (user_id, name, name_key, is_main, sort, created_at, armory_at, armory_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      u.id, finalName, nameKey(finalName), makeMain, existing.length, now, r ? null : now, r ? null : 'PlayNC nicht erreichbar',
    ).lastId;
    if (r) saveResult(id, r);
    if (makeMain) {
      // Neuer Main: Legions-Status neu bewerten
      run('UPDATE users SET main_set_at = ?, legion_status = NULL, legion_mismatch_at = NULL WHERE id = ?', now, u.id);
      applyLegion(userById(u.id)!, r?.legion ?? null, now);
    }
    return id;
  });
  log('character', `➕ ${u.name}: ${makeMain ? 'Main' : 'Twink'} ${finalName} eingetragen.`);
  return get<CharacterRow>('SELECT * FROM characters WHERE id = ?', charId)!;
}

/** Macht einen vorhandenen Charakter zum Main – nur wenn er laut PlayNC in der Legion ist. */
export async function setMain(u: UserRow, charId: number): Promise<void> {
  const c = get<CharacterRow>('SELECT * FROM characters WHERE id = ? AND user_id = ?', charId, u.id);
  if (!c) throw new UserError('Charakter nicht gefunden.', 404);
  if (c.is_main) return;
  let legion: string | null = c.legion;
  if (config.legionCheck) {
    const r = await lookupOrFail(c.name);
    saveResult(c.id, r);
    legion = r.legion ?? null;
    if (!sameLegion(legion, config.aion.legion) && u.legion_status === 'confirmed') {
      throw new UserError(`${c.name} ist laut PlayNC nicht in ${config.aion.legion} (${legion ? `Legion „${legion}“` : 'keine Legion'}). Der Main muss in der Legion sein.`);
    }
  }
  tx(() => {
    run('UPDATE characters SET is_main = (id = ?) WHERE user_id = ?', c.id, u.id);
    if (u.legion_status !== 'confirmed') {
      run('UPDATE users SET main_set_at = ?, legion_status = NULL, legion_mismatch_at = NULL WHERE id = ?', Date.now(), u.id);
      applyLegion(userById(u.id)!, legion);
    }
  });
  log('character', `⭐ ${u.name}: neuer Main ${c.name}.`);
}

export function removeCharacter(u: UserRow, charId: number): void {
  const c = get<CharacterRow>('SELECT * FROM characters WHERE id = ? AND user_id = ?', charId, u.id);
  if (!c) throw new UserError('Charakter nicht gefunden.', 404);
  if (c.is_main && charactersOf(u.id).length > 1) throw new UserError('Mach zuerst einen anderen Charakter zum Main.');
  tx(() => {
    run('DELETE FROM characters WHERE id = ?', c.id);
    run('DELETE FROM task_states WHERE user_id = ? AND char_id = ?', u.id, c.id);
    if (c.is_main) run('UPDATE users SET legion_status = NULL, legion_mismatch_at = NULL WHERE id = ?', u.id);
  });
  log('character', `➖ ${u.name}: ${c.name} entfernt.`);
}

export interface RefreshOutcome {
  ok: boolean;
  error?: string;
}

/** Holt die Werte eines gespeicherten Charakters neu (Main: inkl. Legions-Prüfung). */
export async function refreshCharacter(c: CharacterRow): Promise<RefreshOutcome> {
  try {
    const ref: CharacterRef | null = c.pl_character_id && c.pl_server_id ? { characterId: c.pl_character_id, serverId: c.pl_server_id, name: c.name } : null;
    let r = ref ? await fetchCharacter(ref) : await lookupCharacter(c.name, true);
    // Gespeicherte ID liefert kein Profil mehr (z. B. von PlayNC geändert): über den Namen neu suchen
    if (ref && r && !r.profileFound) r = await lookupCharacter(c.name, true).catch(() => r);
    if (!r) {
      run('UPDATE characters SET armory_at = ?, armory_error = ? WHERE id = ?', Date.now(), 'Nicht gefunden', c.id);
      return { ok: false, error: `„${c.name}“ wurde auf ${config.aion.server} nicht gefunden.` };
    }
    if (!r.profileFound) {
      run('UPDATE characters SET armory_at = ?, armory_error = ? WHERE id = ?', Date.now(), 'Antwort ohne Profil', c.id);
      return { ok: false, error: 'PlayNC hat eine unerwartete Antwort geliefert (kein Profil).' };
    }
    // Namensänderung: nur übernehmen, wenn der neue Name nicht einem anderen gehört
    const clash = get<CharacterRow>('SELECT * FROM characters WHERE name_key = ? AND id != ?', nameKey(r.name), c.id);
    const result = clash ? { ...r, name: c.name } : r;
    tx(() => {
      saveResult(c.id, result);
      if (!clash) run('UPDATE characters SET name_key = ? WHERE id = ?', nameKey(result.name), c.id);
      if (c.is_main) {
        const u = userById(c.user_id);
        if (u) applyLegion(u, r.legion ?? null);
      }
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    run('UPDATE characters SET armory_at = ?, armory_error = ? WHERE id = ?', Date.now(), msg.slice(0, 200), c.id);
    return { ok: false, error: `PlayNC nicht erreichbar: ${msg}` };
  }
}

/** Wann ein Charakter wieder abgefragt werden soll (Twinks halb so oft wie Mains). */
export function dueAt(c: CharacterRow, u: UserRow | undefined, now = Date.now()): number {
  if (!c.armory_at) return 0;
  const regular = c.armory_at + config.refreshHours * HOUR * (c.is_main ? 1 : 2);
  if (!c.is_main || !u) return regular;
  if (u.legion_status === 'pending' && u.main_set_at) {
    const age = now - u.main_set_at;
    if (age < NEW_FAST_WINDOW) return c.armory_at + 10 * MIN;
    if (age < NEW_SLOW_WINDOW) return c.armory_at + HOUR;
  }
  if (u.legion_status === 'confirmed' && u.legion_mismatch_at) return Math.min(regular, c.armory_at + MISMATCH_RECHECK);
  return regular;
}

/** Fragt die am längsten überfälligen Charaktere ab (höchstens `limit` pro Aufruf, nacheinander). */
export async function refreshDue(limit = 1, now = Date.now()): Promise<CharacterRow[]> {
  const users = new Map(all<UserRow>('SELECT * FROM users').map((u) => [u.id, u]));
  const due = all<CharacterRow>('SELECT * FROM characters')
    .filter((c) => !users.get(c.user_id)?.blocked)
    .map((c) => ({ c, at: dueAt(c, users.get(c.user_id), now) }))
    .filter((x) => x.at <= now)
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map((x) => x.c);
  for (const c of due) await refreshCharacter(c);
  return due;
}

// ---- Ansprüche (Charakter gehört schon einem anderen Account) ----

export function createClaim(u: UserRow, name: string, asMain: boolean, note: string): void {
  const c = get<CharacterRow>('SELECT * FROM characters WHERE name_key = ?', nameKey(name));
  if (!c) throw new UserError('Dieser Charakter ist keinem Account zugeordnet – du kannst ihn direkt eintragen.');
  if (c.user_id === u.id) throw new UserError('Der Charakter gehört bereits dir.');
  const open = all<{ name: string }>("SELECT name FROM claims WHERE user_id = ? AND status = 'open'", u.id);
  if (open.some((x) => nameKey(x.name) === c.name_key)) throw new UserError('Du hast für diesen Charakter bereits eine Anfrage gestellt.');
  if (open.length >= 5) throw new UserError('Du hast schon 5 offene Anfragen – bitte warte, bis die Offiziere sie bearbeitet haben.');
  run('INSERT INTO claims (user_id, name, as_main, note, created_at) VALUES (?, ?, ?, ?, ?)', u.id, c.name, asMain, note.slice(0, 300), Date.now());
  log('claim', `❓ ${u.name} beansprucht ${c.name} (gehört ${userById(c.user_id)?.name ?? '?'}).`);
}

/** Admin: Charakter dem Anfragenden übertragen. */
export function transferCharacter(charId: number, toUserId: number, asMain: boolean, by: string): void {
  const c = get<CharacterRow>('SELECT * FROM characters WHERE id = ?', charId);
  const to = userById(toUserId);
  if (!c || !to) throw new UserError('Charakter oder Benutzer nicht gefunden.', 404);
  const from = userById(c.user_id);
  if (charactersOf(to.id).length >= MAX_CHARACTERS) throw new UserError(`${to.name} hat bereits ${MAX_CHARACTERS} Charaktere.`);
  tx(() => {
    run('DELETE FROM task_states WHERE user_id = ? AND char_id = ?', c.user_id, c.id);
    if (c.is_main && from) run('UPDATE users SET legion_status = NULL, legion_mismatch_at = NULL WHERE id = ?', from.id);
    const makeMain = asMain || !mainOf(to.id);
    if (makeMain) run('UPDATE characters SET is_main = 0 WHERE user_id = ?', to.id);
    run('UPDATE characters SET user_id = ?, is_main = ?, sort = 99 WHERE id = ?', to.id, makeMain, c.id);
    if (makeMain) {
      run('UPDATE users SET main_set_at = ?, legion_status = NULL, legion_mismatch_at = NULL WHERE id = ?', Date.now(), to.id);
      applyLegion(userById(to.id)!, c.legion);
    }
  });
  log('claim', `🔁 ${by}: ${c.name} von ${from?.name ?? '?'} an ${to.name} übertragen.`);
}
