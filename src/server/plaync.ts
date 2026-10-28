// Charakterdaten von PlayNC (inoffizielle JSON-Schnittstellen der offiziellen Website).
// Endpunkte und Feldnamen wie im Legions-Bot (abgeglichen mit axsddlr/aion2_api, oldbear24/odyle-dashboard
// und nuriland/aion2-api); die Legion steht im Feld "regionName".

import { classKeyFromName } from '../shared/classes.js';
import { config } from './config.js';
import { fetchJson } from './http.js';

const SEARCH_URL = 'https://api-search.plaync.com/aion2global/search/v2/character';
const INFO_URL = 'https://aion2.plaync.com/api/character/info';
const CACHE_MS = 5 * 60_000;

export interface CharacterRef {
  characterId: string;
  serverId: number;
  serverName?: string;
  name: string;
  level?: number;
}

export interface PlayncCharacter {
  ref: CharacterRef;
  /** false, wenn die Antwort kein Profil enthielt (z. B. geänderte Schnittstelle) */
  profileFound: boolean;
  name: string;
  className?: string;
  classKey?: string;
  level?: number;
  combatPower?: number;
  itemLevel?: number;
  legion?: string;
  race?: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[.,\s]/g, '')) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
export const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '').trim();

/** Wählt aus der Suchantwort den Charakter mit exakt diesem Namen auf dem eigenen Server. */
export function pickSearchResult(json: unknown, name: string, serverId: number): CharacterRef | null {
  const list = isObj(json) && Array.isArray(json.list) ? (json.list as unknown[]) : [];
  const wanted = name.trim().toLowerCase();
  for (const item of list) {
    if (!isObj(item)) continue;
    const itemName = stripTags(str(item.name) ?? '');
    if (itemName.toLowerCase() !== wanted) continue;
    if (serverId && num(item.serverId) !== serverId) continue;
    const rawId = str(item.characterId);
    if (!rawId) continue;
    let characterId = rawId;
    try {
      characterId = decodeURIComponent(rawId);
    } catch {
      // ID war nicht kodiert
    }
    return { characterId, serverId: num(item.serverId) ?? serverId, serverName: str(item.serverName), name: itemName, level: num(item.level) };
  }
  return null;
}

/** Liest die Charakter-Info aus der PlayNC-Antwort. */
export function parseCharacter(ref: CharacterRef, info: unknown): PlayncCharacter {
  const profile = isObj(info) && isObj(info.profile) ? info.profile : {};
  const statList = isObj(info) && isObj(info.stat) && Array.isArray(info.stat.statList) ? (info.stat.statList as unknown[]) : [];
  const itemLevelStat = statList.find((s) => isObj(s) && String(s.type).toLowerCase() === 'itemlevel');
  const className = str(profile.className);
  return {
    ref,
    profileFound: !!(str(profile.characterName) || num(profile.characterLevel) || className),
    name: str(profile.characterName) ?? ref.name,
    className,
    classKey: classKeyFromName(className),
    level: num(profile.characterLevel) ?? ref.level,
    combatPower: num(profile.combatPower),
    itemLevel: isObj(itemLevelStat) ? num(itemLevelStat.value) : undefined,
    legion: str(profile.regionName) ?? str(profile.guildName) ?? str(profile.legionName),
    race: str(profile.raceName),
  };
}

export async function searchCharacter(name: string): Promise<CharacterRef | null> {
  const params = new URLSearchParams({ keyword: name, region: config.aion.region, localeInfo: 'de-DE', page: '1', size: '20' });
  if (config.aion.serverId) params.set('serverId', String(config.aion.serverId));
  const json = await fetchJson(`${SEARCH_URL}?${params}`, { headers: { Referer: 'https://aion2.plaync.com/' } });
  return pickSearchResult(json, name, config.aion.serverId);
}

export async function fetchCharacter(ref: CharacterRef): Promise<PlayncCharacter> {
  const params = new URLSearchParams({ region: config.aion.region, lang: 'en-US', characterId: ref.characterId, serverId: String(ref.serverId) });
  const info = await fetchJson(`${INFO_URL}?${params}`, { headers: { Referer: 'https://aion2.plaync.com/en-us/characters/index' } });
  return parseCharacter(ref, info);
}

const cache = new Map<string, { at: number; data: PlayncCharacter | null }>();

/** Sucht einen Charakter auf dem eigenen Server und lädt seine Daten (5 Minuten Cache, außer fresh). */
export async function lookupCharacter(name: string, fresh = false): Promise<PlayncCharacter | null> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const ref = await searchCharacter(name);
  const data = ref ? await fetchCharacter(ref) : null;
  if (data && !data.profileFound) throw new Error('PlayNC hat eine unerwartete Antwort geliefert (kein Profil).');
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function clearPlayncCache(): void {
  cache.clear();
}

/** Legionsnamen vergleichen (Groß-/Kleinschreibung und Leerzeichen egal). */
export function sameLegion(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return !!n(a) && n(a) === n(b);
}
