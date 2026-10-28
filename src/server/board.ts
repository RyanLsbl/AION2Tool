// Einträge (Standard + eigene), Board der User, Zählerstände, Knöpfe und Vorlagen.

import { DEFAULT_TASKS } from '../shared/defaults.js';
import { applyDelta, available, compute, fmtNum, hasBonus, roundValue, validateTask, type Ctx } from '../shared/engine.js';
import type { ActionDef, BoardItem, Kind, Period, Scope, Section, TaskDef, TaskParams, TaskState } from '../shared/types.js';
import { config } from './config.js';
import { all, get, log, run, tx, type TaskRow, type UserRow } from './db.js';
import { UserError } from './legion.js';
import { charactersOf } from './users.js';

const KINDS: Kind[] = ['regen', 'stack', 'quota', 'check', 'action'];
const SCOPES: Scope[] = ['character', 'account'];
const SECTIONS: Section[] = ['daily', 'weekly'];
const PERIODS: Period[] = ['daily', 'weekly'];
export const MAX_OWN_TASKS = 60;

export function ctxFor(u: UserRow, now = Date.now()): Ctx {
  return { now, abo: !!u.abo, reset: config.reset };
}

export function toTask(r: TaskRow): TaskDef {
  let params: TaskParams = {};
  try {
    params = JSON.parse(r.params) as TaskParams;
  } catch {
    // kaputte Parameter: leer lassen
  }
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    icon: r.icon,
    kind: r.kind as Kind,
    scope: r.scope as Scope,
    section: r.section as Section,
    params,
    note: r.note,
    sort: r.sort,
    active: !!r.active,
    defaultOn: !!r.default_on,
  };
}

export function taskById(id: number): TaskDef | undefined {
  const r = get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
  return r ? toTask(r) : undefined;
}

/** Darf der User diesen Eintrag benutzen? (Standard aktiv oder eigener) */
export function taskFor(u: UserRow, id: number): TaskDef {
  const t = taskById(id);
  if (!t || (t.ownerId !== null && t.ownerId !== u.id) || (t.ownerId === null && !t.active)) throw new UserError('Eintrag nicht gefunden.', 404);
  return t;
}

export function standardTasks(includeInactive = false): TaskDef[] {
  return all<TaskRow>(`SELECT * FROM tasks WHERE owner_id IS NULL ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, id`).map(toTask);
}

export function ownTasks(userId: number): TaskDef[] {
  return all<TaskRow>('SELECT * FROM tasks WHERE owner_id = ? ORDER BY sort, id', userId).map(toTask);
}

/** Legt die Standard-Vorlage beim ersten Start an. */
export function seedStandard(): void {
  if (get("SELECT 1 FROM meta WHERE key = 'seeded'")) return;
  tx(() => {
    const now = Date.now();
    const ids = new Map<string, number>();
    DEFAULT_TASKS.forEach((t, idx) => {
      const { actions: _a, ...rest } = t.params;
      const id = run(
        `INSERT INTO tasks (owner_id, seed_key, name, icon, kind, scope, section, params, note, sort, created_at, updated_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.key, t.name, t.icon, t.kind, t.scope, t.section, JSON.stringify(rest), t.note, idx, now, now,
      ).lastId;
      ids.set(t.key, id);
    });
    for (const t of DEFAULT_TASKS) {
      if (!t.params.actions) continue;
      const { actions, ...rest } = t.params;
      const resolved: ActionDef[] = actions.map((a) => ({
        id: a.id,
        label: a.label,
        aboOnly: a.aboOnly,
        effects: a.effects.flatMap((e) => (ids.has(e.key) ? [{ taskId: ids.get(e.key)!, delta: e.delta }] : [])),
      }));
      run('UPDATE tasks SET params = ? WHERE id = ?', JSON.stringify({ ...rest, actions: resolved }), ids.get(t.key)!);
    }
    run("INSERT INTO meta (key, value) VALUES ('seeded', ?)", String(now));
  });
}

// ---- Eingaben prüfen ----

type TaskInput = Pick<TaskDef, 'name' | 'icon' | 'kind' | 'scope' | 'section' | 'params' | 'note'> & { defaultOn?: boolean };

const optNum = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** Prüft und bereinigt einen Eintrag aus dem Builder. allowed = IDs, auf die Knöpfe wirken dürfen. */
export function parseTaskInput(body: unknown, allowed: Set<number>): TaskInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const kind = String(b.kind) as Kind;
  const scope = String(b.scope) as Scope;
  const section = String(b.section) as Section;
  if (!KINDS.includes(kind) || !SCOPES.includes(scope) || !SECTIONS.includes(section)) throw new UserError('Ungültige Art, Gültigkeit oder Bereich.');
  const p = (b.params && typeof b.params === 'object' ? b.params : {}) as Record<string, unknown>;
  const params: TaskParams = {};
  const period = PERIODS.includes(p.period as Period) ? (p.period as Period) : section === 'weekly' ? 'weekly' : 'daily';
  if (kind !== 'regen') params.period = period;
  if (kind === 'regen') params.intervalHours = Number(p.intervalHours);
  if (kind === 'regen' || kind === 'stack' || kind === 'quota') params.amount = Number(p.amount);
  if (kind === 'regen' || kind === 'stack') {
    params.cap = Number(p.cap);
    params.capAbo = optNum(p.capAbo);
    const bonusCap = optNum(p.bonusCap);
    if (bonusCap) params.bonusCap = bonusCap;
  }
  if (kind === 'regen' && typeof p.anchor === 'string' && p.anchor.trim()) params.anchor = p.anchor.trim();
  if (kind === 'quota') params.amountAbo = optNum(p.amountAbo);
  if (kind !== 'check' && kind !== 'action') {
    const step = optNum(p.step);
    if (step != null && step > 0) params.step = step;
    if (typeof p.unit === 'string' && p.unit.trim()) params.unit = p.unit.trim().slice(0, 8);
  }
  const minLevel = optNum(p.minLevel);
  if (minLevel) params.minLevel = Math.floor(minLevel);
  if (p.warn === false) params.warn = false;
  if (kind === 'action') {
    const acts = Array.isArray(p.actions) ? (p.actions as Record<string, unknown>[]) : [];
    params.actions = acts.slice(0, 6).map((a, i) => ({
      id: typeof a.id === 'string' && /^[\w-]{1,20}$/.test(a.id) ? a.id : `a${i + 1}`,
      label: String(a.label ?? '').trim().slice(0, 30),
      aboOnly: a.aboOnly === true || undefined,
      effects: (Array.isArray(a.effects) ? (a.effects as Record<string, unknown>[]) : []).slice(0, 4).map((e) => ({
        taskId: Number(e.taskId),
        delta: Number(e.delta),
      })),
    }));
    const ids = new Set(params.actions.map((a) => a.id));
    if (ids.size !== params.actions.length) params.actions.forEach((a, i) => (a.id = `a${i + 1}`));
    for (const a of params.actions) {
      for (const e of a.effects) if (!allowed.has(e.taskId)) throw new UserError('Ein Knopf wirkt auf einen Eintrag, der nicht verfügbar ist.');
    }
  }
  const input: TaskInput = {
    name: String(b.name ?? '').trim(),
    icon: typeof b.icon === 'string' && b.icon.trim() ? [...b.icon.trim()].slice(0, 4).join('') : '✅',
    kind,
    scope,
    section,
    params,
    note: String(b.note ?? '').trim().slice(0, 400),
    defaultOn: b.defaultOn !== false,
  };
  const err = validateTask(input);
  if (err) throw new UserError(err);
  return input;
}

/** Einträge, auf die Knöpfe eines Users wirken dürfen (aktive Standard-Einträge + eigene). */
export function effectTargetsFor(userId: number | null): Set<number> {
  const rows =
    userId === null
      ? all<{ id: number }>('SELECT id FROM tasks WHERE owner_id IS NULL AND active = 1')
      : all<{ id: number }>('SELECT id FROM tasks WHERE (owner_id IS NULL AND active = 1) OR owner_id = ?', userId);
  return new Set(rows.map((r) => r.id));
}

export function insertTask(ownerId: number | null, t: TaskInput): number {
  const now = Date.now();
  const sort = (get<{ s: number }>('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM tasks WHERE owner_id IS ?', ownerId)?.s ?? 0);
  return run(
    `INSERT INTO tasks (owner_id, name, icon, kind, scope, section, params, note, sort, default_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ownerId, t.name, t.icon, t.kind, t.scope, t.section, JSON.stringify(t.params), t.note, sort, t.defaultOn !== false, now, now,
  ).lastId;
}

export function updateTask(id: number, t: TaskInput): void {
  run(
    'UPDATE tasks SET name = ?, icon = ?, kind = ?, scope = ?, section = ?, params = ?, note = ?, default_on = ?, updated_at = ? WHERE id = ?',
    t.name, t.icon, t.kind, t.scope, t.section, JSON.stringify(t.params), t.note, t.defaultOn !== false, Date.now(), id,
  );
}

// ---- Board ----

export function addToBoard(userId: number, taskId: number): void {
  const sort = get<{ s: number }>('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM board_items WHERE user_id = ?', userId)?.s ?? 0;
  run('INSERT OR IGNORE INTO board_items (user_id, task_id, sort) VALUES (?, ?, ?)', userId, taskId, sort);
}

/** Neue User bekommen alle Standard-Einträge, die „für neue Mitglieder“ markiert sind. */
export function ensureBoard(u: UserRow): void {
  if (u.board_seeded) return;
  tx(() => {
    for (const t of standardTasks()) if (t.defaultOn) addToBoard(u.id, t.id);
    run('UPDATE users SET board_seeded = 1 WHERE id = ?', u.id);
  });
  u.board_seeded = 1;
}

export interface BoardData {
  tasks: TaskDef[];
  items: BoardItem[];
  states: TaskState[];
}

export function boardFor(u: UserRow): BoardData {
  ensureBoard(u);
  const rows = all<{ task_id: number; sort: number; hidden: number; off_chars: string; muted: number }>(
    `SELECT b.* FROM board_items b JOIN tasks t ON t.id = b.task_id
     WHERE b.user_id = ? AND ((t.owner_id IS NULL AND t.active = 1) OR t.owner_id = ?) ORDER BY b.sort, t.sort, t.id`,
    u.id, u.id,
  );
  const items: BoardItem[] = rows.map((r) => ({
    taskId: r.task_id,
    sort: r.sort,
    hidden: !!r.hidden,
    offChars: safeIds(r.off_chars),
    muted: !!r.muted,
  }));
  // Alle Einträge, die der User sehen/als Knopf-Ziel brauchen kann
  const tasks = all<TaskRow>('SELECT * FROM tasks WHERE (owner_id IS NULL AND active = 1) OR owner_id = ? ORDER BY sort, id', u.id).map(toTask);
  const states = all<{ task_id: number; char_id: number; value: number; bonus: number; at: number }>(
    'SELECT task_id, char_id, value, bonus, at FROM task_states WHERE user_id = ?',
    u.id,
  ).map((s) => ({ taskId: s.task_id, charId: s.char_id, value: s.value, bonus: s.bonus, at: s.at }));
  return { tasks, items, states };
}

function safeIds(json: string): number[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

export function updateBoardItems(u: UserRow, items: unknown): void {
  if (!Array.isArray(items) || items.length > 200) throw new UserError('Ungültige Liste.');
  const charIds = new Set(charactersOf(u.id).map((c) => c.id));
  tx(() => {
    for (const raw of items as Record<string, unknown>[]) {
      const taskId = Number(raw.taskId);
      if (!Number.isInteger(taskId)) continue;
      const off = Array.isArray(raw.offChars) ? (raw.offChars as unknown[]).map(Number).filter((id) => charIds.has(id)) : [];
      run(
        'UPDATE board_items SET sort = ?, hidden = ?, off_chars = ?, muted = ? WHERE user_id = ? AND task_id = ?',
        Math.max(0, Math.floor(Number(raw.sort) || 0)), raw.hidden === true, JSON.stringify(off), raw.muted === true, u.id, taskId,
      );
    }
  });
}

// ---- Zählerstände ----

function stateRow(userId: number, taskId: number, charId: number): TaskState | undefined {
  const r = get<{ value: number; bonus: number; at: number }>(
    'SELECT value, bonus, at FROM task_states WHERE user_id = ? AND task_id = ? AND char_id = ?',
    userId, taskId, charId,
  );
  return r ? { taskId, charId, value: r.value, bonus: r.bonus, at: r.at } : undefined;
}

function writeState(userId: number, s: TaskState): void {
  run(
    `INSERT INTO task_states (user_id, task_id, char_id, value, bonus, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, task_id, char_id) DO UPDATE SET value = excluded.value, bonus = excluded.bonus, at = excluded.at`,
    userId, s.taskId, s.charId, s.value, s.bonus, s.at,
  );
}

/** Prüft, ob charId zum Eintrag passt (Account = 0, sonst eigener Charakter). */
function checkChar(u: UserRow, t: TaskDef, charId: number): void {
  if (t.scope === 'account') {
    if (charId !== 0) throw new UserError('Dieser Eintrag gilt für den ganzen Account.');
    return;
  }
  if (!charactersOf(u.id).some((c) => c.id === charId)) throw new UserError('Charakter nicht gefunden.', 404);
}

export interface StateChange {
  before: TaskState | null;
  after: TaskState;
}

const validAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000;

/** Stand ändern: um delta (Knöpfe +/−) oder auf einen festen Wert (Ingame-Wert eintragen). */
export function changeState(u: UserRow, taskId: number, charId: number, op: { delta?: number; value?: number; bonus?: number }): StateChange {
  const t = taskFor(u, taskId);
  if (t.kind === 'action') throw new UserError('Knopf-Einträge haben keinen eigenen Stand.');
  checkChar(u, t, charId);
  const ctx = ctxFor(u);
  const before = stateRow(u.id, taskId, charId) ?? null;
  let next: { value: number; bonus: number };
  if (op.value !== undefined) {
    if (!validAmount(op.value)) throw new UserError('Bitte eine Zahl zwischen 0 und 1.000.000 eingeben.');
    if (op.bonus !== undefined && !validAmount(op.bonus)) throw new UserError('Ungültiger Extra-Vorrat.');
    const bonus = hasBonus(t) ? Math.min(t.params.bonusCap ?? 0, op.bonus ?? compute(t, before ?? undefined, ctx).bonus) : 0;
    next = { value: t.kind === 'check' ? (op.value > 0 ? 1 : 0) : roundValue(op.value), bonus: roundValue(bonus) };
  } else {
    const delta = Number(op.delta);
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100_000) throw new UserError('Ungültige Änderung.');
    next = applyDelta(t, before ?? undefined, delta, ctx);
  }
  const after: TaskState = { taskId, charId, ...next, at: ctx.now };
  writeState(u.id, after);
  return { before, after };
}

/**
 * Knopf drücken: wendet alle Wirkungen an und zählt die Nutzung – alles oder nichts.
 * Abzüge brauchen Deckung (z. B. 40 Odyl für eine Belohnung), sonst passiert gar nichts.
 */
export function runAction(u: UserRow, taskId: number, charId: number, actionId: string): StateChange[] {
  const t = taskFor(u, taskId);
  if (t.kind !== 'action') throw new UserError('Dieser Eintrag hat keine Knöpfe.');
  checkChar(u, t, charId);
  const action = (t.params.actions ?? []).find((a) => a.id === actionId);
  if (!action) throw new UserError('Knopf nicht gefunden.', 404);
  if (action.aboOnly && !u.abo) throw new UserError('Dieser Knopf ist nur mit Abo verfügbar.');
  const ctx = ctxFor(u);
  return tx(() => {
    const changes: StateChange[] = [];
    for (const e of action.effects) {
      // Ziel gelöscht/deaktiviert: Wirkung überspringen
      const target = taskById(e.taskId);
      if (!target || target.kind === 'action' || (target.ownerId !== null && target.ownerId !== u.id) || (target.ownerId === null && !target.active)) continue;
      const targetChar = target.scope === 'account' ? 0 : charId;
      const before = stateRow(u.id, target.id, targetChar) ?? null;
      if (e.delta < 0) {
        const cur = compute(target, before ?? undefined, ctx);
        if (cur.value == null) throw new UserError(`Trag zuerst deinen aktuellen Stand bei „${target.name}“ ein.`);
        const have = available(cur);
        if (have < -e.delta) {
          throw new UserError(`Nicht genug ${target.name}: ${fmtNum(have)}${target.params.unit ? ` ${target.params.unit}` : ''} vorhanden, ${fmtNum(-e.delta)} nötig.`);
        }
      }
      const after: TaskState = { taskId: target.id, charId: targetChar, ...applyDelta(target, before ?? undefined, e.delta, ctx), at: ctx.now };
      writeState(u.id, after);
      changes.push({ before, after });
    }
    // Nutzungszähler des Knopf-Eintrags (pro Zeitraum)
    const before = stateRow(u.id, t.id, charId) ?? null;
    const count = (compute(t, before ?? undefined, ctx).value ?? 0) + 1;
    const after: TaskState = { taskId: t.id, charId, value: count, bonus: 0, at: ctx.now };
    writeState(u.id, after);
    changes.push({ before, after });
    return changes;
  });
}

/** Rückgängig: setzt Stände auf den vorherigen Wert zurück (oder löscht sie, wenn es keinen gab). */
export function restoreStates(u: UserRow, states: unknown): void {
  if (!Array.isArray(states) || states.length > 10) throw new UserError('Ungültige Liste.');
  tx(() => {
    for (const raw of states as Record<string, unknown>[]) {
      const taskId = Number(raw.taskId);
      const charId = Number(raw.charId);
      const t = taskFor(u, taskId);
      checkChar(u, t, charId);
      if (raw.value === null) {
        run('DELETE FROM task_states WHERE user_id = ? AND task_id = ? AND char_id = ?', u.id, taskId, charId);
        continue;
      }
      const value = Number(raw.value);
      const bonus = Number(raw.bonus ?? 0);
      const at = Number(raw.at);
      if (!validAmount(value) || !validAmount(bonus) || !Number.isFinite(at) || at > Date.now() + 60_000 || at < Date.now() - 400 * 86_400_000) {
        throw new UserError('Ungültiger Stand.');
      }
      writeState(u.id, { taskId, charId, value: roundValue(value), bonus: hasBonus(t) ? roundValue(bonus) : 0, at });
    }
  });
}

// ---- Vorlagen ----

export interface TaskSnapshot {
  id: number;
  name: string;
  icon: string;
  kind: Kind;
  scope: Scope;
  section: Section;
  params: TaskParams;
  note: string;
}

export interface TemplateData {
  standard: number[];
  own: TaskSnapshot[];
}

export interface TemplateRow {
  id: number;
  user_id: number | null;
  author: string;
  name: string;
  description: string;
  data: string;
  uses: number;
  promoted_at: number | null;
  created_at: number;
}

const snapshot = (t: TaskDef): TaskSnapshot => ({
  id: t.id, name: t.name, icon: t.icon, kind: t.kind, scope: t.scope, section: t.section, params: t.params, note: t.note,
});

export function publishTemplate(u: UserRow, name: string, description: string, taskIds: unknown): number {
  const n = name.trim();
  if (!n || n.length > 60) throw new UserError('Bitte einen Namen (höchstens 60 Zeichen) angeben.');
  if (!Array.isArray(taskIds) || !taskIds.length) throw new UserError('Bitte mindestens einen Eintrag auswählen.');
  if ((get<{ n: number }>('SELECT COUNT(*) AS n FROM templates WHERE user_id = ?', u.id)?.n ?? 0) >= 20) throw new UserError('Höchstens 20 Vorlagen pro Account.');
  const data: TemplateData = { standard: [], own: [] };
  for (const id of new Set(taskIds.map(Number))) {
    const t = taskFor(u, id);
    if (t.ownerId === null) data.standard.push(t.id);
    else data.own.push(snapshot(t));
  }
  const id = run(
    'INSERT INTO templates (user_id, author, name, description, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    u.id, u.name, n, description.trim().slice(0, 300), JSON.stringify(data), Date.now(),
  ).lastId;
  log('template', `📤 ${u.name} hat die Vorlage „${n}“ veröffentlicht.`);
  return id;
}

export function templateData(row: TemplateRow): TemplateData {
  try {
    const d = JSON.parse(row.data) as TemplateData;
    return { standard: Array.isArray(d.standard) ? d.standard : [], own: Array.isArray(d.own) ? d.own : [] };
  } catch {
    return { standard: [], own: [] };
  }
}

/** Legt Kopien der Snapshot-Einträge an und setzt Knopf-Verweise auf die neuen IDs um. */
function insertSnapshots(ownerId: number | null, own: TaskSnapshot[]): number[] {
  const valid = effectTargetsFor(ownerId);
  const map = new Map<number, number>();
  const created: number[] = [];
  for (const s of own) {
    const { actions: _a, ...rest } = s.params;
    const id = insertTask(ownerId, { ...s, params: rest });
    map.set(s.id, id);
    created.push(id);
  }
  own.forEach((s) => {
    if (s.kind !== 'action') return;
    const actions = (s.params.actions ?? []).map((a) => ({
      ...a,
      effects: a.effects.flatMap((e) => {
        const id = map.get(e.taskId) ?? (valid.has(e.taskId) ? e.taskId : null);
        return id ? [{ taskId: id, delta: e.delta }] : [];
      }),
    }));
    run('UPDATE tasks SET params = ? WHERE id = ?', JSON.stringify({ ...s.params, actions }), map.get(s.id)!);
  });
  return created;
}

export function importTemplate(u: UserRow, templateId: number): { added: number } {
  const row = get<TemplateRow>('SELECT * FROM templates WHERE id = ?', templateId);
  if (!row) throw new UserError('Vorlage nicht gefunden.', 404);
  const data = templateData(row);
  ensureBoard(u);
  if (ownTasks(u.id).length + data.own.length > MAX_OWN_TASKS) throw new UserError(`Höchstens ${MAX_OWN_TASKS} eigene Einträge.`);
  return tx(() => {
    let added = 0;
    const active = new Set(standardTasks().map((t) => t.id));
    const onBoard = new Set(all<{ task_id: number }>('SELECT task_id FROM board_items WHERE user_id = ?', u.id).map((r) => r.task_id));
    for (const id of data.standard) {
      if (active.has(id) && !onBoard.has(id)) {
        addToBoard(u.id, id);
        added++;
      }
    }
    for (const id of insertSnapshots(u.id, data.own)) {
      addToBoard(u.id, id);
      added++;
    }
    run('UPDATE templates SET uses = uses + 1 WHERE id = ?', row.id);
    return { added };
  });
}

/** Offiziere: Einträge einer Vorlage in den Standard übernehmen. */
export function promoteTemplate(templateId: number, addToAll: boolean, by: string): number {
  const row = get<TemplateRow>('SELECT * FROM templates WHERE id = ?', templateId);
  if (!row) throw new UserError('Vorlage nicht gefunden.', 404);
  const data = templateData(row);
  if (!data.own.length) throw new UserError('Die Vorlage enthält nur Standard-Einträge.');
  return tx(() => {
    const ids = insertSnapshots(null, data.own);
    if (addToAll) for (const id of ids) addStandardToAll(id);
    run('UPDATE templates SET promoted_at = ? WHERE id = ?', Date.now(), row.id);
    log('template', `⭐ ${by} hat „${row.name}“ (${ids.length} Einträge) zum Standard gemacht.`);
    return ids.length;
  });
}

export function addStandardToAll(taskId: number): void {
  for (const r of all<{ id: number }>('SELECT id FROM users WHERE board_seeded = 1')) addToBoard(r.id, taskId);
}
