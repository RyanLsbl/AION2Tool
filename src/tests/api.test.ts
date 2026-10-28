import './setup.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';
import { seedStandard } from '../server/board.js';
import { get, openDb, run, type UserRow } from '../server/db.js';
import { resetHttpState, setFetchImpl } from '../server/http.js';
import { applyLegion, refreshDue } from '../server/legion.js';
import { clearPlayncCache } from '../server/plaync.js';
import { resetRateLimits } from '../server/ratelimit.js';
import type { BoardItem, TaskDef, TaskState } from '../shared/types.js';

// ---- Simuliertes PlayNC + Steam ----

interface FakeChar {
  id: string;
  name: string;
  legion: string | null;
  level?: number;
  cp?: number;
}
const plaync = new Map<string, FakeChar>();
let playncDown = false;
let steamValid = true;

function addFake(name: string, legion: string | null, level = 50): void {
  plaync.set(name.toLowerCase(), { id: `id-${name}`, name, legion, level, cp: 1000 + name.length });
}

setFetchImpl(async (input, init) => {
  const url = new URL(String(input));
  if (url.host === 'steamcommunity.com') {
    return new Response(steamValid ? 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n' : 'is_valid:false\n');
  }
  if (playncDown) return new Response('down', { status: 502 });
  if (url.pathname.includes('/search/')) {
    const kw = url.searchParams.get('keyword')!.toLowerCase();
    const c = plaync.get(kw);
    return Response.json({ list: c ? [{ name: `<b>${c.name}</b>`, characterId: encodeURIComponent(c.id), serverId: 1319, serverName: 'Ishtar', level: c.level }] : [] });
  }
  if (url.pathname.endsWith('/character/info')) {
    const id = url.searchParams.get('characterId');
    const c = [...plaync.values()].find((x) => x.id === id);
    if (!c) return Response.json({});
    return Response.json({
      profile: { characterName: c.name, className: 'Templar', characterLevel: c.level, combatPower: c.cp, regionName: c.legion ?? undefined, raceName: 'Elyos' },
      stat: { statList: [{ type: 'ItemLevel', value: 2100 }] },
    });
  }
  void init;
  return new Response('?', { status: 404 });
});

// ---- Helfer ----

let app: FastifyInstance;
const OWNER = '76561198000000001';

async function login(steamId: string): Promise<string> {
  const nonce = `${new Date().toISOString().slice(0, 19)}Z${Math.random().toString(36).slice(2)}`;
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  const q = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': 'http://localhost:3000/auth/steam/callback',
    'openid.response_nonce': nonce,
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'abc=',
  });
  const res = await app.inject({ method: 'GET', url: `/auth/steam/callback?${q}` });
  const cookie = res.cookies.find((c) => c.name === 'aion2_sid');
  assert.ok(cookie, `Login fehlgeschlagen: ${res.headers.location}`);
  return `aion2_sid=${cookie.value}`;
}

async function api<T = Record<string, unknown>>(cookie: string, method: string, url: string, payload?: unknown, expect = 200): Promise<T> {
  const res = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, 'x-requested-with': 'aion2tool', origin: 'http://localhost:3000' },
  });
  assert.equal(res.statusCode, expect, `${method} ${url}: ${res.body}`);
  return res.json() as T;
}

interface Board {
  tasks: TaskDef[];
  items: BoardItem[];
  states: TaskState[];
}

function user(steamId: string): UserRow {
  return get<UserRow>('SELECT * FROM users WHERE steam_id = ?', steamId)!;
}

async function member(steamId: string, main: string): Promise<string> {
  addFake(main, 'Altersheim');
  const c = await login(steamId);
  await api(c, 'POST', '/api/characters', { name: main });
  return c;
}

before(async () => {
  app = await buildApp();
});
after(async () => {
  await app.close();
});
beforeEach(() => {
  openDb(':memory:');
  seedStandard();
  plaync.clear();
  playncDown = false;
  steamValid = true;
  resetHttpState();
  clearPlayncCache();
  resetRateLimits();
});

describe('Steam-Login', () => {
  it('leitet zu Steam weiter', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/steam' });
    assert.equal(res.statusCode, 302);
    assert.match(res.headers.location!, /^https:\/\/steamcommunity\.com\/openid\/login\?/);
    assert.match(decodeURIComponent(res.headers.location!), /return_to=http:\/\/localhost:3000\/auth\/steam\/callback/);
  });

  it('meldet an und lehnt ungültige Antworten ab', async () => {
    const cookie = await login('76561198000000002');
    const me = await api<{ me: { access: string } }>(cookie, 'GET', '/api/me');
    assert.equal(me.me.access, 'needs-main');

    steamValid = false;
    const res = await app.inject({ method: 'GET', url: '/auth/steam/callback?openid.mode=id_res' });
    assert.equal(res.statusCode, 302);
    assert.match(res.headers.location!, /loginError=/);
    assert.equal(res.cookies.length, 0);
  });

  it('lehnt ändernde Anfragen ohne Schutz-Header ab (CSRF)', async () => {
    const cookie = await login('76561198000000002');
    const res = await app.inject({ method: 'PUT', url: '/api/me/settings', payload: { abo: true }, headers: { cookie } });
    assert.equal(res.statusCode, 403);
    const foreign = await app.inject({
      method: 'PUT', url: '/api/me/settings', payload: { abo: true },
      headers: { cookie, 'x-requested-with': 'aion2tool', origin: 'https://evil.example' },
    });
    assert.equal(foreign.statusCode, 403);
  });
});

describe('Legions-Prüfung', () => {
  it('Main in Altersheim → Zugang, Board mit Standard-Einträgen', async () => {
    const c = await member('76561198000000002', 'Lyra');
    const me = await api<{ me: { access: string; characters: { name: string; isMain: boolean; combatPower: number; itemLevel: number }[] } }>(c, 'GET', '/api/me');
    assert.equal(me.me.access, 'ok');
    assert.equal(me.me.characters[0].name, 'Lyra');
    assert.equal(me.me.characters[0].itemLevel, 2100);
    const board = await api<Board>(c, 'GET', '/api/board');
    assert.ok(board.items.length >= 10);
    assert.ok(board.tasks.some((t) => t.name === 'Albtraum'));
  });

  it('Main nicht in der Legion → wartet, kein Zugriff aufs Board', async () => {
    addFake('Fremdi', 'Andere Legion');
    const c = await login('76561198000000003');
    await api(c, 'POST', '/api/characters', { name: 'Fremdi' });
    const me = await api<{ me: { access: string; legionSeen: string } }>(c, 'GET', '/api/me');
    assert.equal(me.me.access, 'pending');
    assert.equal(me.me.legionSeen, 'Andere Legion');
    await api(c, 'GET', '/api/board', undefined, 403);
  });

  it('Charakter nicht gefunden / PlayNC nicht erreichbar', async () => {
    const c = await login('76561198000000003');
    const nf = await api<{ error: string }>(c, 'POST', '/api/characters', { name: 'Gibtsnicht' }, 404);
    assert.match(nf.error, /nicht gefunden/);
    playncDown = true;
    addFake('Lyra', 'Altersheim');
    await api(c, 'POST', '/api/characters', { name: 'Lyra' }, 503);
  });

  it('Austritt erst nach zwei Prüfungen ≥ 1 Std., Wiedereintritt schaltet frei', async () => {
    const c = await member('76561198000000002', 'Lyra');
    const t0 = Date.now();
    applyLegion(user('76561198000000002'), null, t0);
    assert.equal(user('76561198000000002').legion_status, 'confirmed');
    applyLegion(user('76561198000000002'), null, t0 + 30 * 60_000);
    assert.equal(user('76561198000000002').legion_status, 'confirmed');
    applyLegion(user('76561198000000002'), null, t0 + 61 * 60_000);
    assert.equal(user('76561198000000002').legion_status, 'left');
    await api(c, 'GET', '/api/board', undefined, 403);
    applyLegion(user('76561198000000002'), 'altersheim', t0 + 2 * 3_600_000);
    assert.equal(user('76561198000000002').legion_status, 'confirmed');
  });

  it('Notbremse: viele gleichzeitige Austritte sperren niemanden', async () => {
    for (let i = 0; i < 4; i++) await member(`7656119800000010${i}`, `Spieler${'abcd'[i]}`);
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) applyLegion(user(`7656119800000010${i}`), null, t0);
    for (let i = 0; i < 4; i++) applyLegion(user(`7656119800000010${i}`), null, t0 + 2 * 3_600_000);
    for (let i = 0; i < 4; i++) assert.equal(user(`7656119800000010${i}`).legion_status, 'confirmed');
  });

  it('Hintergrund-Aktualisierung prüft den Main', async () => {
    await member('76561198000000002', 'Lyra');
    run('UPDATE characters SET armory_at = 0');
    plaync.get('lyra')!.legion = null;
    await refreshDue(5);
    assert.ok(user('76561198000000002').legion_mismatch_at);
  });
});

describe('Charaktere & Ansprüche', () => {
  it('ein Charakter gehört nur einem Account; Admin überträgt auf Anfrage', async () => {
    await member('76561198000000002', 'Lyra');
    const thief = await login('76561198000000003');
    const r = await api<{ code: string }>(thief, 'POST', '/api/characters', { name: 'lyra' }, 409);
    assert.equal(r.code, 'claimed');
    await api(thief, 'POST', '/api/claims', { name: 'Lyra', note: 'Das ist mein Charakter' });

    const owner = await member(OWNER, 'Chef');
    const claims = await api<{ claims: { id: number; owner: string; claimant: string }[] }>(owner, 'GET', '/api/admin/claims');
    assert.equal(claims.claims[0].owner, 'Steam-User …0002');
    await api(owner, 'POST', `/api/admin/claims/${claims.claims[0].id}`, { action: 'transfer' });
    assert.equal(user('76561198000000003').legion_status, 'confirmed');
    assert.equal(user('76561198000000002').legion_status, null);
  });

  it('Twinks müssen nicht in der Legion sein', async () => {
    const c = await member('76561198000000002', 'Lyra');
    addFake('Twinki', null);
    const me = await api<{ me: { access: string; characters: { name: string; isMain: boolean }[] } }>(c, 'POST', '/api/characters', { name: 'Twinki' });
    assert.equal(me.me.access, 'ok');
    assert.deepEqual(me.me.characters.map((x) => [x.name, x.isMain]), [['Lyra', true], ['Twinki', false]]);
    // Twink ohne Legion kann nicht Main werden
    const twink = get<{ id: number }>("SELECT id FROM characters WHERE name = 'Twinki'")!;
    await api(c, 'POST', `/api/characters/${twink.id}/main`, {}, 400);
  });
});

describe('Board, Knöpfe und Builder', () => {
  it('Expedition mit/ohne Belohnung verändert Odyl bzw. das Wochen-Kontingent', async () => {
    const c = await member('76561198000000002', 'Lyra');
    const charId = get<{ id: number }>("SELECT id FROM characters WHERE name = 'Lyra'")!.id;
    const board = await api<Board>(c, 'GET', '/api/board');
    const odyl = board.tasks.find((t) => t.name === 'Odyl-Energie')!;
    const runs = board.tasks.find((t) => t.name === 'Expedition / Transzendenz')!;
    const quota = board.tasks.find((t) => t.name === 'Läufe ohne Belohnung')!;

    // Ohne eingetragenen Odyl-Stand geht „mit Belohnung“ nicht
    const noStand = await api<{ error: string }>(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'reward' }, 400);
    assert.match(noStand.error, /Trag zuerst/);
    await api(c, 'POST', '/api/state', { taskId: odyl.id, charId, value: 300 });
    const r1 = await api<{ changes: { after: TaskState }[] }>(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'reward' });
    assert.equal(r1.changes.find((x) => x.after.taskId === odyl.id)!.after.value, 260);
    await api(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'noreward' });
    const b2 = await api<Board>(c, 'GET', '/api/board');
    assert.equal(b2.states.find((s) => s.taskId === quota.id && s.charId === 0)!.value, 9);
    assert.equal(b2.states.find((s) => s.taskId === runs.id && s.charId === charId)!.value, 2);

    // Doppelt nur mit Abo
    await api(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'double' }, 400);
    await api(c, 'PUT', '/api/me/settings', { abo: true });
    await api(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'double' });

    // Server-weite Einträge nur mit charId 0
    await api(c, 'POST', '/api/state', { taskId: quota.id, charId, delta: -1 }, 400);

    // Nicht genug Odyl: nichts wird verändert
    await api(c, 'POST', '/api/state', { taskId: odyl.id, charId, value: 30 });
    const poor = await api<{ error: string }>(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'reward' }, 400);
    assert.match(poor.error, /Nicht genug Odyl-Energie: 30 vorhanden, 40 nötig/);
    // Extra-Vorrat aus Items zählt mit und wird nach dem natürlichen verbraucht
    await api(c, 'POST', '/api/state', { taskId: odyl.id, charId, delta: 40 });
    const rich = await api<{ changes: { after: TaskState }[] }>(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'reward' });
    const o = rich.changes.find((x) => x.after.taskId === odyl.id)!.after;
    assert.deepEqual([o.value, o.bonus], [0, 30]);

    // Kontingent ohne Belohnung aufgebraucht
    await api(c, 'POST', '/api/state', { taskId: quota.id, charId: 0, value: 0 });
    const none = await api<{ error: string }>(c, 'POST', '/api/action', { taskId: runs.id, charId, actionId: 'noreward' }, 400);
    assert.match(none.error, /Nicht genug Läufe ohne Belohnung/);
  });

  it('Stand und Extra-Vorrat direkt eintragen', async () => {
    const c = await member('76561198000000002', 'Lyra');
    const charId = get<{ id: number }>("SELECT id FROM characters WHERE name = 'Lyra'")!.id;
    const board = await api<Board>(c, 'GET', '/api/board');
    const nm = board.tasks.find((t) => t.name === 'Albtraum')!;
    const shugo = board.tasks.find((t) => t.name === 'Shugo-Festival-Schlüssel')!;
    const r = await api<{ changes: { after: TaskState }[] }>(c, 'POST', '/api/state', { taskId: nm.id, charId, value: 12, bonus: 50 });
    assert.deepEqual([r.changes[0].after.value, r.changes[0].after.bonus], [12, 30]);
    // Einträge ohne Extra-Vorrat speichern keinen
    const r2 = await api<{ changes: { after: TaskState }[] }>(c, 'POST', '/api/state', { taskId: shugo.id, charId: 0, value: 5, bonus: 3 });
    assert.deepEqual([r2.changes[0].after.value, r2.changes[0].after.bonus], [5, 0]);
    await api(c, 'POST', '/api/state', { taskId: nm.id, charId, value: -1 }, 400);
  });

  it('Rückgängig stellt den alten Stand wieder her', async () => {
    const c = await member('76561198000000002', 'Lyra');
    const charId = get<{ id: number }>("SELECT id FROM characters WHERE name = 'Lyra'")!.id;
    const board = await api<Board>(c, 'GET', '/api/board');
    const nm = board.tasks.find((t) => t.name === 'Albtraum')!;
    await api(c, 'POST', '/api/state', { taskId: nm.id, charId, value: 5 });
    const r = await api<{ changes: { before: TaskState; after: TaskState }[] }>(c, 'POST', '/api/state', { taskId: nm.id, charId, delta: -1 });
    assert.equal(r.changes[0].after.value, 4);
    await api(c, 'POST', '/api/state/restore', { states: r.changes.map((x) => x.before) });
    const b = await api<Board>(c, 'GET', '/api/board');
    assert.equal(b.states.find((s) => s.taskId === nm.id)!.value, 5);
  });

  it('eigene Einträge, Vorlage veröffentlichen und übernehmen (Knopf-Verweise werden umgesetzt)', async () => {
    const a = await member('76561198000000002', 'Lyra');
    const b = await member('76561198000000003', 'Bryn');
    const board = await api<Board>(a, 'GET', '/api/board');
    const odyl = board.tasks.find((t) => t.name === 'Odyl-Energie')!;

    const { id: ticketId } = await api<{ id: number }>(a, 'POST', '/api/tasks', {
      name: 'Heiligtum', icon: '🏛️', kind: 'quota', scope: 'character', section: 'weekly', params: { period: 'weekly', amount: 4 },
    });
    const { id: actionId } = await api<{ id: number }>(a, 'POST', '/api/tasks', {
      name: 'Ludra-Lauf', icon: '🐉', kind: 'action', scope: 'character', section: 'weekly',
      params: { period: 'weekly', actions: [{ label: 'Lauf', effects: [{ taskId: ticketId, delta: -1 }, { taskId: odyl.id, delta: -40 }] }] },
    });
    // Fremde Einträge dürfen nicht als Ziel benutzt werden
    const { id: bOwn } = await api<{ id: number }>(b, 'POST', '/api/tasks', { name: 'Geheim', kind: 'check', scope: 'character', section: 'daily', params: {} });
    await api(a, 'POST', '/api/tasks', {
      name: 'Böse', kind: 'action', scope: 'character', section: 'daily', params: { actions: [{ label: 'x', effects: [{ taskId: bOwn, delta: -1 }] }] },
    }, 400);
    await api(a, 'PUT', `/api/tasks/${bOwn}`, { name: 'Weg', kind: 'check', scope: 'character', section: 'daily', params: {} }, 404);

    const { id: tplId } = await api<{ id: number }>(a, 'POST', '/api/templates', { name: 'Raid-Woche', taskIds: [ticketId, actionId, odyl.id] });
    const imp = await api<{ added: number }>(b, 'POST', `/api/templates/${tplId}/import`);
    assert.equal(imp.added, 2);
    const bb = await api<Board>(b, 'GET', '/api/board');
    const newTicket = bb.tasks.find((t) => t.name === 'Heiligtum' && t.ownerId === user('76561198000000003').id)!;
    const newAction = bb.tasks.find((t) => t.name === 'Ludra-Lauf')!;
    assert.deepEqual(newAction.params.actions![0].effects.map((e) => e.taskId), [newTicket.id, odyl.id]);
  });

  it('Offiziere pflegen den Standard; normale Mitglieder nicht', async () => {
    const m = await member('76561198000000002', 'Lyra');
    await api(m, 'GET', '/api/admin/standard', undefined, 403);
    const owner = await member(OWNER, 'Chef');
    const { id } = await api<{ id: number }>(owner, 'POST', '/api/admin/standard', {
      name: 'Unterwerfung', icon: '⚔️', kind: 'quota', scope: 'character', section: 'weekly', params: { period: 'weekly', amount: 3 }, addToAll: true,
    });
    const b = await api<Board>(m, 'GET', '/api/board');
    assert.ok(b.items.some((i) => i.taskId === id));

    // Offizier ernennen
    const members = await api<{ members: { id: number; steamId: string }[] }>(owner, 'GET', '/api/admin/members');
    const target = members.members.find((x) => x.steamId === '76561198000000002')!;
    await api(owner, 'POST', `/api/admin/members/${target.id}`, { officer: true });
    await api(m, 'GET', '/api/admin/progress');

    // Deaktivieren entfernt den Eintrag aus den Boards
    await api(owner, 'POST', `/api/admin/standard/${id}/active`, { active: false });
    const b2 = await api<Board>(m, 'GET', '/api/board');
    assert.ok(!b2.items.some((i) => i.taskId === id));
  });

  it('gesperrte Mitglieder verlieren den Zugang – auch nach erneutem Login', async () => {
    const m = await member('76561198000000002', 'Lyra');
    const owner = await member(OWNER, 'Chef');
    await api(owner, 'POST', `/api/admin/members/${user('76561198000000002').id}`, { blocked: true });
    const res = await app.inject({ method: 'GET', url: '/api/board', headers: { cookie: m } });
    assert.equal(res.statusCode, 401);
    const again = await login('76561198000000002');
    const me = await api<{ me: { access: string } }>(again, 'GET', '/api/me');
    assert.equal(me.me.access, 'blocked');
    addFake('Neuer', 'Altersheim');
    await api(again, 'POST', '/api/characters', { name: 'Neuer' }, 403);
    await api(again, 'GET', '/api/board', undefined, 403);
  });

  it('Account löschen entfernt alle Daten', async () => {
    const m = await member('76561198000000002', 'Lyra');
    await api(m, 'DELETE', '/api/me');
    assert.equal(user('76561198000000002'), undefined);
    assert.equal(get("SELECT 1 FROM characters WHERE name = 'Lyra'"), undefined);
    // Der Name ist wieder frei
    await member('76561198000000003', 'Lyra');
  });

  it('PlayNC-Abfragen pro User sind begrenzt', async () => {
    const c = await login('76561198000000004');
    for (let i = 0; i < 10; i++) await api(c, 'POST', '/api/characters', { name: `Nix${'abcdefghij'[i]}` }, 404);
    await api(c, 'POST', '/api/characters', { name: 'Nixk' }, 429);
  });
});
