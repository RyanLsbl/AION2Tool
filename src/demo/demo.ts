// Demo-Modus: startet das Tool mit simuliertem PlayNC und einer Beispiel-Legion.
// Kein Steam und kein PlayNC nötig – zum Ausprobieren und Entwickeln (npm run demo).
// Anmeldung: http://localhost:3000/auth/dev  (Haupt-Admin „Lyra“)
//            http://localhost:3000/auth/dev?steamid=76561190000000002  (Mitglied „Borin“)

import './env.js';
import { buildApp } from '../server/app.js';
import { boardFor, changeState, seedStandard } from '../server/board.js';
import { config } from '../server/config.js';
import { get, openDb, run, type UserRow } from '../server/db.js';
import { setFetchImpl } from '../server/http.js';
import { addCharacter, createClaim } from '../server/legion.js';
import { upsertSteamUser } from '../server/users.js';

interface FakeChar {
  name: string;
  className: string;
  level: number;
  cp: number;
  il: number;
  legion: string | null;
}

const LEGION = config.aion.legion;
const chars: FakeChar[] = [
  { name: 'Lyra', className: 'Templar', level: 50, cp: 48210, il: 2140, legion: LEGION },
  { name: 'Kaelis', className: 'Cleric', level: 47, cp: 31890, il: 1880, legion: LEGION },
  { name: 'Nyx', className: 'Assassin', level: 42, cp: 22040, il: 1510, legion: null },
  { name: 'Borin', className: 'Gladiator', level: 50, cp: 51770, il: 2210, legion: LEGION },
  { name: 'Selene', className: 'Sorcerer', level: 50, cp: 45320, il: 2090, legion: LEGION },
  { name: 'Theron', className: 'Chanter', level: 49, cp: 39010, il: 1990, legion: LEGION },
  { name: 'Mira', className: 'Ranger', level: 50, cp: 47100, il: 2120, legion: 'Sternenwacht' },
  { name: 'Faelan', className: 'Spiritmaster', level: 50, cp: 44480, il: 2060, legion: LEGION },
];
const byId = (id: string | null) => chars.find((c) => `demo-${c.name}` === id);

// Simuliertes PlayNC (gleiche Antwortformate wie die echte Website)
setFetchImpl(async (input) => {
  const url = new URL(String(input));
  if (url.pathname.includes('/search/')) {
    const kw = (url.searchParams.get('keyword') ?? '').toLowerCase();
    const c = chars.find((x) => x.name.toLowerCase() === kw);
    return Response.json({ list: c ? [{ name: c.name, characterId: `demo-${c.name}`, serverId: config.aion.serverId, serverName: config.aion.server, level: c.level }] : [] });
  }
  if (url.pathname.endsWith('/character/info')) {
    const c = byId(url.searchParams.get('characterId'));
    if (!c) return Response.json({});
    return Response.json({
      profile: { characterName: c.name, className: c.className, characterLevel: c.level, combatPower: c.cp, regionName: c.legion ?? undefined, raceName: 'Elyos' },
      stat: { statList: [{ type: 'ItemLevel', value: c.il }] },
    });
  }
  return new Response('Demo: nicht verfügbar', { status: 404 });
});

openDb(config.dbPath);
seedStandard();

const user = (steamId: string) => get<UserRow>('SELECT * FROM users WHERE steam_id = ?', steamId)!;
const H = 3_600_000;

async function member(steamId: string, name: string, main: string, twinks: string[] = [], abo = false): Promise<UserRow> {
  upsertSteamUser(steamId, { name, avatar: null });
  await addCharacter(user(steamId), main, true);
  for (const t of twinks) await addCharacter(user(steamId), t, false);
  if (abo) run('UPDATE users SET abo = 1 WHERE steam_id = ?', steamId);
  const u = user(steamId);
  boardFor(u);
  return u;
}

function setState(u: UserRow, taskName: string, charName: string | null, value: number, bonus?: number, hoursAgo = 2): void {
  const t = get<{ id: number }>('SELECT id FROM tasks WHERE name = ? AND owner_id IS NULL', taskName);
  if (!t) return;
  const charId = charName ? get<{ id: number }>('SELECT id FROM characters WHERE name = ?', charName)!.id : 0;
  changeState(u, t.id, charId, { value, bonus });
  run('UPDATE task_states SET at = ? WHERE user_id = ? AND task_id = ? AND char_id = ?', Date.now() - hoursAgo * H, u.id, t.id, charId);
}

const lyra = await member('76561190000000001', 'Lyra (Demo)', 'Lyra', ['Kaelis', 'Nyx'], true);
setState(lyra, 'Odyl-Energie', 'Lyra', 790, 40, 1);
setState(lyra, 'Odyl-Energie', 'Kaelis', 310, 0, 5);
setState(lyra, 'Albtraum', 'Lyra', 13, 4);
setState(lyra, 'Albtraum', 'Kaelis', 6);
setState(lyra, 'Shugo-Festival-Schlüssel', null, 21);
setState(lyra, 'Aufträge', null, 2, undefined, 1);
setState(lyra, 'Tägliches Dungeon', null, 9);
setState(lyra, 'Läufe ohne Belohnung', null, 7);
setState(lyra, 'Aufstiegsprüfung', 'Lyra', 1);
setState(lyra, 'Schlachtfeld-Siege', 'Lyra', 0);

const borin = await member('76561190000000002', 'Borin', 'Borin', ['Theron']);
setState(borin, 'Odyl-Energie', 'Borin', 545, 0, 1);
setState(borin, 'Albtraum', 'Borin', 14);
setState(borin, 'Shugo-Festival-Schlüssel', null, 12);
setState(borin, 'Tägliches Dungeon', null, 0);
setState(borin, 'Aufstiegsprüfung', 'Borin', 0);

const selene = await member('76561190000000003', 'Selene', 'Selene');
setState(selene, 'Albtraum', 'Selene', 4);
setState(selene, 'Tägliches Dungeon', null, 14);

await member('76561190000000004', 'Faelan', 'Faelan');
// Wartet auf Bestätigung (laut PlayNC in einer anderen Legion)
await member('76561190000000005', 'Mira', 'Mira');
// Anfrage: jemand beansprucht einen vergebenen Charakter
upsertSteamUser('76561190000000006', { name: 'Unbekannt', avatar: null });
createClaim(user('76561190000000006'), 'Selene', true, 'Das ist mein Charakter – Discord: selene#1234');

const app = await buildApp();
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`\nDemo läuft: ${config.publicUrl}`);
console.log(`  Haupt-Admin:  ${config.publicUrl}/auth/dev`);
console.log(`  Mitglied:     ${config.publicUrl}/auth/dev?steamid=76561190000000002`);
console.log(`  Neuer User:   ${config.publicUrl}/auth/dev?steamid=76561190000000099&name=Neuling\n`);
