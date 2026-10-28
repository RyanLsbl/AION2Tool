// Fastify-App: Login, API und Auslieferung der Oberfläche.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { DEFAULT_PREFS, type AppInfo, type Prefs } from '../shared/types.js';
import { registerAdminRoutes } from './admin.js';
import { requireAccess, requireUser } from './guards.js';
import { rateLimit } from './ratelimit.js';
import {
  boardFor, changeState, effectTargetsFor, importTemplate, insertTask, MAX_OWN_TASKS, ownTasks, parseTaskInput, publishTemplate,
  addToBoard, restoreStates, runAction, standardTasks, taskFor, templateData, updateBoardItems, updateTask, type TemplateRow,
} from './board.js';
import { config } from './config.js';
import { all, get, log, run, tx, type CharacterRow, type UserRow } from './db.js';
import { addCharacter, createClaim, refreshCharacter, removeCharacter, setMain, UserError } from './legion.js';
import { fetchSteamProfile, LoginError, loginRedirectUrl, verifyAssertion } from './steam.js';
import {
  accessOf, createSession, deleteSession, isOfficer, prefsOf, SESSION_COOKIE, SESSION_DAYS, toMe, upsertSteamUser, userForSession,
} from './users.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(here, '..', 'web');

export function appInfo(): AppInfo {
  return {
    legion: config.aion.legion,
    server: config.aion.server,
    reset: config.reset,
    devLogin: config.devLogin,
  };
}

const int = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError('Ungültige ID.');
  return n;
};

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 256 * 1024 });
  await app.register(fastifyCookie);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    req.user = userForSession(req.cookies[SESSION_COOKIE]);
    // Schutz gegen fremde Seiten (CSRF): ändernde API-Aufrufe nur von der eigenen Adresse
    if (req.url.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      const allowed = new Set([config.publicUrl, `${req.protocol}://${req.headers.host}`]);
      if (origin && !allowed.has(origin)) return reply.code(403).send({ error: 'Anfrage von fremder Seite abgelehnt.' });
      if (req.headers['x-requested-with'] !== 'aion2tool') return reply.code(403).send({ error: 'Ungültige Anfrage.' });
    }
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://*.steamstatic.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://steamcommunity.com",
    );
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof UserError) return reply.code(err.status).send({ error: err.message, code: err.code });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'Ungültige Anfrage.' });
    req.log.error(err);
    console.error(err);
    return reply.code(500).send({ error: 'Interner Fehler – bitte später erneut versuchen.' });
  });

  // ---------- Login ----------

  app.get('/auth/steam', async (_req, reply) => reply.redirect(loginRedirectUrl()));

  app.get('/auth/steam/callback', async (req, reply) => {
    try {
      const steamId = await verifyAssertion(req.query as Record<string, string>);
      const profile = await fetchSteamProfile(steamId);
      const u = upsertSteamUser(steamId, profile);
      setSessionCookie(reply, createSession(u.id));
      return reply.redirect('/');
    } catch (e) {
      const msg = e instanceof LoginError ? e.message : 'Steam-Login fehlgeschlagen.';
      if (!(e instanceof LoginError)) console.error(e);
      return reply.redirect(`/?loginError=${encodeURIComponent(msg)}`);
    }
  });

  if (config.devLogin) {
    // Nur für lokale Tests (DEV_LOGIN=an): Anmeldung ohne Steam
    app.get('/auth/dev', async (req, reply) => {
      const q = req.query as { steamid?: string; name?: string };
      const steamId = /^\d{17}$/.test(q.steamid ?? '') ? q.steamid! : '76561190000000001';
      // Ohne Namen bleibt ein vorhandener Name erhalten
      const u = upsertSteamUser(steamId, q.name ? { name: q.name.slice(0, 64), avatar: null } : null);
      setSessionCookie(reply, createSession(u.id));
      return reply.redirect('/');
    });
  }

  app.post('/api/logout', async (req, reply) => {
    deleteSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Account samt Charakteren, Checkliste und eigenen Einträgen löschen
  app.delete('/api/me', async (req, reply) => {
    const u = requireUser(req);
    run('DELETE FROM users WHERE id = ?', u.id);
    log('member', `🗑️ Account gelöscht: ${u.name}.`);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- Ich & Charaktere ----------

  app.get('/api/info', async () => appInfo());

  app.get('/api/me', async (req) => {
    if (!req.user) return { me: null, info: appInfo() };
    return { me: toMe(req.user), info: appInfo() };
  });

  app.put('/api/me/settings', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { abo?: unknown; prefs?: Partial<Prefs> };
    if (typeof b.abo === 'boolean') run('UPDATE users SET abo = ? WHERE id = ?', b.abo, u.id);
    if (b.prefs && typeof b.prefs === 'object') {
      const cur = prefsOf(u);
      const next: Prefs = { ...DEFAULT_PREFS, ...cur };
      for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
        const v = Number(b.prefs[k]);
        if (b.prefs[k] !== undefined && Number.isFinite(v) && v >= 0 && v <= 168) next[k] = v;
      }
      run('UPDATE users SET prefs = ? WHERE id = ?', JSON.stringify(next), u.id);
    }
    return { me: toMe(get<UserRow>('SELECT * FROM users WHERE id = ?', u.id)!) };
  });

  // PlayNC-Abfragen, die User auslösen, sind begrenzt (die Warteschlange zu PlayNC soll frei bleiben)
  const playncLimit = (u: UserRow) => rateLimit(`plaync:${u.id}`, 10, 10 * 60_000, 'Zu viele Abfragen bei PlayNC – bitte ein paar Minuten warten.');

  app.post('/api/characters', async (req) => {
    const u = requireUser(req);
    playncLimit(u);
    const b = (req.body ?? {}) as { name?: string; main?: boolean };
    // Ohne Zugang darf nur ein Main eingetragen werden
    const asMain = b.main === true || accessOf(u) !== 'ok';
    await addCharacter(u, String(b.name ?? ''), asMain);
    return { me: toMe(get<UserRow>('SELECT * FROM users WHERE id = ?', u.id)!) };
  });

  app.post('/api/characters/:id/main', async (req) => {
    const u = requireUser(req);
    playncLimit(u);
    await setMain(u, int((req.params as { id: string }).id));
    return { me: toMe(get<UserRow>('SELECT * FROM users WHERE id = ?', u.id)!) };
  });

  app.post('/api/characters/:id/refresh', async (req) => {
    const u = requireUser(req);
    const c = get<CharacterRow>('SELECT * FROM characters WHERE id = ? AND user_id = ?', int((req.params as { id: string }).id), u.id);
    if (!c) throw new UserError('Charakter nicht gefunden.', 404);
    rateLimit(`refresh:${c.id}`, 1, 60_000, 'Bitte warte eine Minute bis zur nächsten Aktualisierung.');
    playncLimit(u);
    const r = await refreshCharacter(c);
    return { me: toMe(get<UserRow>('SELECT * FROM users WHERE id = ?', u.id)!), error: r.ok ? undefined : r.error };
  });

  app.delete('/api/characters/:id', async (req) => {
    const u = requireUser(req);
    removeCharacter(u, int((req.params as { id: string }).id));
    return { me: toMe(get<UserRow>('SELECT * FROM users WHERE id = ?', u.id)!) };
  });

  app.post('/api/claims', async (req) => {
    const u = requireUser(req);
    rateLimit(`claim:${u.id}`, 5, 60 * 60_000);
    const b = (req.body ?? {}) as { name?: string; main?: boolean; note?: string };
    createClaim(u, String(b.name ?? ''), b.main === true || accessOf(u) !== 'ok', String(b.note ?? ''));
    return { ok: true };
  });

  // ---------- Board ----------

  app.get('/api/board', async (req) => {
    const u = requireAccess(req);
    return { ...boardFor(u), now: Date.now() };
  });

  app.post('/api/state', async (req) => {
    const u = requireAccess(req);
    const b = (req.body ?? {}) as { taskId?: unknown; charId?: unknown; delta?: unknown; value?: unknown; bonus?: unknown };
    const op =
      b.value !== undefined && b.value !== null
        ? { value: Number(b.value), bonus: b.bonus === undefined || b.bonus === null ? undefined : Number(b.bonus) }
        : { delta: Number(b.delta) };
    const change = changeState(u, int(b.taskId), int(b.charId), op);
    return { changes: [change] };
  });

  app.post('/api/action', async (req) => {
    const u = requireAccess(req);
    const b = (req.body ?? {}) as { taskId?: unknown; charId?: unknown; actionId?: unknown };
    return { changes: runAction(u, int(b.taskId), int(b.charId), String(b.actionId ?? '')) };
  });

  app.post('/api/state/restore', async (req) => {
    const u = requireAccess(req);
    restoreStates(u, (req.body as { states?: unknown })?.states);
    return { ok: true };
  });

  // ---------- Builder ----------

  app.put('/api/board/items', async (req) => {
    const u = requireAccess(req);
    updateBoardItems(u, (req.body as { items?: unknown })?.items);
    return { ok: true };
  });

  app.post('/api/board/items', async (req) => {
    const u = requireAccess(req);
    const t = taskFor(u, int((req.body as { taskId?: unknown })?.taskId));
    addToBoard(u.id, t.id);
    return { ok: true };
  });

  app.delete('/api/board/items/:taskId', async (req) => {
    const u = requireAccess(req);
    const taskId = int((req.params as { taskId: string }).taskId);
    run('DELETE FROM board_items WHERE user_id = ? AND task_id = ?', u.id, taskId);
    return { ok: true };
  });

  app.post('/api/tasks', async (req) => {
    const u = requireAccess(req);
    if (ownTasks(u.id).length >= MAX_OWN_TASKS) throw new UserError(`Höchstens ${MAX_OWN_TASKS} eigene Einträge.`);
    const input = parseTaskInput(req.body, effectTargetsFor(u.id));
    const id = tx(() => {
      const id = insertTask(u.id, input);
      addToBoard(u.id, id);
      return id;
    });
    return { id };
  });

  app.put('/api/tasks/:id', async (req) => {
    const u = requireAccess(req);
    const id = int((req.params as { id: string }).id);
    const t = taskFor(u, id);
    if (t.ownerId !== u.id) throw new UserError('Standard-Einträge können nur Offiziere ändern.', 403);
    const targets = effectTargetsFor(u.id);
    targets.delete(id);
    updateTask(id, parseTaskInput(req.body, targets));
    return { ok: true };
  });

  app.delete('/api/tasks/:id', async (req) => {
    const u = requireAccess(req);
    const id = int((req.params as { id: string }).id);
    const t = taskFor(u, id);
    if (t.ownerId !== u.id) throw new UserError('Standard-Einträge kannst du nur aus deinem Board entfernen.', 403);
    run('DELETE FROM tasks WHERE id = ?', id);
    return { ok: true };
  });

  app.get('/api/catalog', async (req) => {
    const u = requireAccess(req);
    const templates = all<TemplateRow>('SELECT * FROM templates ORDER BY promoted_at IS NULL, uses DESC, id DESC LIMIT 200');
    return {
      standard: standardTasks(),
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        author: t.author,
        mine: t.user_id === u.id,
        uses: t.uses,
        promoted: !!t.promoted_at,
        createdAt: t.created_at,
        data: templateData(t),
      })),
    };
  });

  app.post('/api/templates', async (req) => {
    const u = requireAccess(req);
    const b = (req.body ?? {}) as { name?: string; description?: string; taskIds?: unknown };
    return { id: publishTemplate(u, String(b.name ?? ''), String(b.description ?? ''), b.taskIds) };
  });

  app.post('/api/templates/:id/import', async (req) => {
    const u = requireAccess(req);
    return importTemplate(u, int((req.params as { id: string }).id));
  });

  app.delete('/api/templates/:id', async (req) => {
    const u = requireAccess(req);
    const id = int((req.params as { id: string }).id);
    const row = get<TemplateRow>('SELECT * FROM templates WHERE id = ?', id);
    if (!row) throw new UserError('Vorlage nicht gefunden.', 404);
    if (row.user_id !== u.id && !isOfficer(u)) throw new UserError('Nur eigene Vorlagen können gelöscht werden.', 403);
    run('DELETE FROM templates WHERE id = ?', id);
    return { ok: true };
  });

  registerAdminRoutes(app);

  app.all('/api/*', async (_req, reply) => reply.code(404).send({ error: 'Nicht gefunden.' }));

  // ---------- Oberfläche ----------

  if (existsSync(WEB_DIR)) {
    await app.register(fastifyStatic, {
      root: WEB_DIR,
      // Dateien bei jeder Anfrage suchen (nicht nur die beim Start vorhandenen) – robust bei Neubau im laufenden Betrieb
      wildcard: true,
      // Caching selbst steuern: index.html nie (Updates kommen sofort an), Dateien mit Hash-Namen dauerhaft
      cacheControl: false,
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.header('Cache-Control', 'no-cache');
        else if (/[\\/]assets[\\/]/.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'public, max-age=86400');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/auth/')) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Nicht gefunden.' });
    });
  }

  return app;
}
