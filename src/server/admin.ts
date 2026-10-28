// Admin-/Offiziers-API: Standard-Einträge, Mitglieder, Ansprüche, Fortschritt, Vorlagen, Protokoll.

import type { FastifyInstance } from 'fastify';
import { compute, levelOk } from '../shared/engine.js';
import type { TaskState } from '../shared/types.js';
import { requireOfficer } from './guards.js';
import {
  addStandardToAll, ctxFor, effectTargetsFor, insertTask, parseTaskInput, promoteTemplate, standardTasks, taskById, updateTask,
} from './board.js';
import { all, get, log, run, tx, type CharacterRow, type UserRow } from './db.js';
import { refreshCharacter, transferCharacter, UserError } from './legion.js';
import { accessOf, charactersOf, isOwner, mainOf, toCharacter, userById } from './users.js';

const int = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError('Ungültige ID.');
  return n;
};

export function registerAdminRoutes(app: FastifyInstance): void {
  // ---------- Standard-Einträge ----------

  app.get('/api/admin/standard', async (req) => {
    requireOfficer(req);
    return { tasks: standardTasks(true) };
  });

  app.post('/api/admin/standard', async (req) => {
    const u = requireOfficer(req);
    const input = parseTaskInput(req.body, effectTargetsFor(null));
    const addToAll = (req.body as { addToAll?: unknown })?.addToAll !== false;
    const id = tx(() => {
      const id = insertTask(null, input);
      if (addToAll) addStandardToAll(id);
      return id;
    });
    log('standard', `➕ ${u.name}: Standard-Eintrag „${input.name}“ angelegt${addToAll ? ' (allen hinzugefügt)' : ''}.`);
    return { id };
  });

  app.put('/api/admin/standard/order', async (req) => {
    requireOfficer(req);
    const ids = (req.body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids)) throw new UserError('Ungültige Liste.');
    tx(() => ids.forEach((id, idx) => run('UPDATE tasks SET sort = ? WHERE id = ? AND owner_id IS NULL', idx, int(id))));
    return { ok: true };
  });

  app.put('/api/admin/standard/:id', async (req) => {
    const u = requireOfficer(req);
    const id = int((req.params as { id: string }).id);
    const t = taskById(id);
    if (!t || t.ownerId !== null) throw new UserError('Standard-Eintrag nicht gefunden.', 404);
    const targets = effectTargetsFor(null);
    targets.delete(id);
    const input = parseTaskInput(req.body, targets);
    updateTask(id, input);
    log('standard', `✏️ ${u.name}: Standard-Eintrag „${input.name}“ geändert.`);
    return { ok: true };
  });

  app.post('/api/admin/standard/:id/active', async (req) => {
    const u = requireOfficer(req);
    const id = int((req.params as { id: string }).id);
    const t = taskById(id);
    if (!t || t.ownerId !== null) throw new UserError('Standard-Eintrag nicht gefunden.', 404);
    const active = (req.body as { active?: unknown })?.active === true;
    run('UPDATE tasks SET active = ?, updated_at = ? WHERE id = ?', active, Date.now(), id);
    if (active) addStandardToAll(id);
    log('standard', `${active ? '👁️' : '🚫'} ${u.name}: „${t.name}“ ${active ? 'aktiviert' : 'deaktiviert'}.`);
    return { ok: true };
  });

  // ---------- Mitglieder ----------

  app.get('/api/admin/members', async (req) => {
    requireOfficer(req);
    const users = all<UserRow>('SELECT * FROM users ORDER BY name COLLATE NOCASE');
    return {
      members: users.map((u) => ({
        id: u.id,
        steamId: u.steam_id,
        name: u.name,
        avatar: u.avatar,
        officer: !!u.officer,
        owner: isOwner(u),
        blocked: !!u.blocked,
        access: accessOf(u),
        legionStatus: u.legion_status,
        legionSeen: u.legion_seen,
        legionCheckedAt: u.legion_checked_at,
        lastLogin: u.last_login,
        createdAt: u.created_at,
        characters: charactersOf(u.id).map(toCharacter),
      })),
    };
  });

  app.post('/api/admin/members/:id', async (req) => {
    const me = requireOfficer(req);
    const u = userById(int((req.params as { id: string }).id));
    if (!u) throw new UserError('Benutzer nicht gefunden.', 404);
    const b = (req.body ?? {}) as { blocked?: unknown; officer?: unknown };
    if (typeof b.blocked === 'boolean') {
      if (isOwner(u)) throw new UserError('Haupt-Admins können nicht gesperrt werden.');
      if (u.officer && !isOwner(me)) throw new UserError('Offiziere kann nur ein Haupt-Admin sperren.', 403);
      run('UPDATE users SET blocked = ? WHERE id = ?', b.blocked, u.id);
      if (b.blocked) run('DELETE FROM sessions WHERE user_id = ?', u.id);
      log('member', `${b.blocked ? '⛔' : '✅'} ${me.name}: ${u.name} ${b.blocked ? 'gesperrt' : 'entsperrt'}.`);
    }
    if (typeof b.officer === 'boolean') {
      if (!isOwner(me)) throw new UserError('Offiziere ernennen können nur Haupt-Admins.', 403);
      run('UPDATE users SET officer = ? WHERE id = ?', b.officer, u.id);
      log('member', `🎖️ ${me.name}: ${u.name} ist ${b.officer ? 'jetzt' : 'nicht mehr'} Offizier.`);
    }
    return { ok: true };
  });

  app.post('/api/admin/members/:id/recheck', async (req) => {
    requireOfficer(req);
    const u = userById(int((req.params as { id: string }).id));
    const main = u && mainOf(u.id);
    if (!main) throw new UserError('Kein Main eingetragen.', 404);
    const r = await refreshCharacter(main);
    return { ok: r.ok, error: r.error };
  });

  app.delete('/api/admin/characters/:id', async (req) => {
    const me = requireOfficer(req);
    const c = get<CharacterRow>('SELECT * FROM characters WHERE id = ?', int((req.params as { id: string }).id));
    if (!c) throw new UserError('Charakter nicht gefunden.', 404);
    const owner = userById(c.user_id);
    if (owner && isOwner(owner) && !isOwner(me)) throw new UserError('Charaktere von Haupt-Admins kann nur ein Haupt-Admin lösen.', 403);
    tx(() => {
      run('DELETE FROM characters WHERE id = ?', c.id);
      run('DELETE FROM task_states WHERE user_id = ? AND char_id = ?', c.user_id, c.id);
      if (c.is_main) run('UPDATE users SET legion_status = NULL, legion_mismatch_at = NULL WHERE id = ?', c.user_id);
    });
    log('member', `🔓 ${me.name}: ${c.name} von ${userById(c.user_id)?.name ?? '?'} gelöst.`);
    return { ok: true };
  });

  // ---------- Ansprüche ----------

  app.get('/api/admin/claims', async (req) => {
    requireOfficer(req);
    const rows = all<{ id: number; user_id: number; name: string; as_main: number; note: string; status: string; created_at: number }>(
      "SELECT * FROM claims ORDER BY status = 'open' DESC, id DESC LIMIT 100",
    );
    return {
      claims: rows.map((r) => {
        const c = get<CharacterRow>('SELECT * FROM characters WHERE name_key = ?', r.name.toLowerCase());
        return {
          id: r.id,
          name: r.name,
          asMain: !!r.as_main,
          note: r.note,
          status: r.status,
          createdAt: r.created_at,
          claimant: userById(r.user_id)?.name ?? '?',
          claimantId: r.user_id,
          owner: c ? (userById(c.user_id)?.name ?? '?') : null,
          characterId: c?.id ?? null,
        };
      }),
    };
  });

  app.post('/api/admin/claims/:id', async (req) => {
    const me = requireOfficer(req);
    const id = int((req.params as { id: string }).id);
    const claim = get<{ id: number; user_id: number; name: string; as_main: number; status: string }>('SELECT * FROM claims WHERE id = ?', id);
    if (!claim || claim.status !== 'open') throw new UserError('Anfrage nicht gefunden oder schon erledigt.', 404);
    const action = (req.body as { action?: unknown })?.action;
    if (action === 'transfer') {
      const c = get<CharacterRow>('SELECT * FROM characters WHERE name_key = ?', claim.name.toLowerCase());
      if (c && c.user_id !== claim.user_id) transferCharacter(c.id, claim.user_id, !!claim.as_main, me.name);
      run("UPDATE claims SET status = 'done', resolved_at = ? WHERE id = ?", Date.now(), id);
    } else if (action === 'reject') {
      run("UPDATE claims SET status = 'rejected', resolved_at = ? WHERE id = ?", Date.now(), id);
      log('claim', `✖️ ${me.name}: Anspruch auf ${claim.name} abgelehnt.`);
    } else {
      throw new UserError('Ungültige Aktion.');
    }
    return { ok: true };
  });

  // ---------- Fortschritt ----------

  app.get('/api/admin/progress', async (req) => {
    requireOfficer(req);
    const tasks = standardTasks().filter((t) => t.kind !== 'action');
    const users = all<UserRow>('SELECT * FROM users WHERE blocked = 0 ORDER BY name COLLATE NOCASE').filter((u) => accessOf(u) === 'ok');
    const rows = users.map((u) => {
      const ctx = ctxFor(u);
      const chars = charactersOf(u.id);
      const items = new Map(
        all<{ task_id: number; hidden: number; off_chars: string }>('SELECT task_id, hidden, off_chars FROM board_items WHERE user_id = ?', u.id).map((r) => [r.task_id, r]),
      );
      const rawStates = all<{ task_id: number; char_id: number; value: number; bonus: number; at: number }>('SELECT * FROM task_states WHERE user_id = ?', u.id);
      const states = new Map(
        rawStates.map((s) => [`${s.task_id}:${s.char_id}`, { taskId: s.task_id, charId: s.char_id, value: s.value, bonus: s.bonus, at: s.at } as TaskState]),
      );
      const lastActivity = rawStates.reduce((m, s) => Math.max(m, s.at), 0) || null;
      const cells: Record<number, { charId: number; value: number | null; bonus: number; max: number | null }[]> = {};
      for (const t of tasks) {
        const item = items.get(t.id);
        if (!item || item.hidden) continue;
        let off: number[] = [];
        try {
          off = JSON.parse(item.off_chars) as number[];
        } catch {
          // ignorieren
        }
        const targets = t.scope === 'account' ? [0] : chars.filter((c) => !off.includes(c.id) && levelOk(t, c.level)).map((c) => c.id);
        cells[t.id] = targets.map((charId) => {
          const c = compute(t, states.get(`${t.id}:${charId}`), ctx);
          return { charId, value: c.value, bonus: c.bonus, max: c.max };
        });
      }
      return {
        userId: u.id,
        name: u.name,
        abo: !!u.abo,
        lastActivity,
        characters: chars.map((c) => ({ id: c.id, name: c.name, isMain: !!c.is_main, classKey: c.class_key, combatPower: c.combat_power, itemLevel: c.item_level })),
        cells,
      };
    });
    return { tasks, rows };
  });

  // ---------- Vorlagen & Protokoll ----------

  app.post('/api/admin/templates/:id/promote', async (req) => {
    const me = requireOfficer(req);
    const addToAll = (req.body as { addToAll?: unknown })?.addToAll === true;
    return { added: promoteTemplate(int((req.params as { id: string }).id), addToAll, me.name) };
  });

  app.get('/api/admin/log', async (req) => {
    requireOfficer(req);
    return { entries: all<{ id: number; at: number; kind: string; text: string }>('SELECT * FROM log ORDER BY id DESC LIMIT 300') };
  });
}
