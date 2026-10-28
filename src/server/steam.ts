// Steam-Login über OpenID 2.0 (https://steamcommunity.com/openid).
// Steam liefert nur die Steam-ID; Name und Avatar kommen optional über die Steam-Web-API (STEAM_API_KEY).

import { config } from './config.js';
import { get, run } from './db.js';
import { fetchImpl } from './http.js';

export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const NONCE_MAX_AGE = 10 * 60_000;

export function returnUrl(): string {
  return `${config.publicUrl}/auth/steam/callback`;
}

export function loginRedirectUrl(): string {
  const p = new URLSearchParams({
    'openid.ns': NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl(),
    'openid.realm': config.publicUrl,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${p}`;
}

export class LoginError extends Error {}

/**
 * Prüft die Antwort von Steam und gibt die Steam-ID zurück.
 * 1. Antwort muss an unsere return_to-Adresse gehen und von Steam stammen
 * 2. Nonce darf nur einmal benutzt werden und nicht zu alt sein
 * 3. Steam bestätigt die Signatur per check_authentication
 */
export async function verifyAssertion(query: Record<string, string | undefined>, now = Date.now()): Promise<string> {
  if (query['openid.mode'] !== 'id_res') throw new LoginError('Der Steam-Login wurde abgebrochen.');
  if (query['openid.op_endpoint'] !== STEAM_OPENID) throw new LoginError('Ungültige Antwort (falscher Anbieter).');
  if (query['openid.return_to'] !== returnUrl()) throw new LoginError('Ungültige Antwort (falsche Rücksprung-Adresse). Stimmt PUBLIC_URL?');
  const claimed = query['openid.claimed_id'] ?? '';
  const m = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
  if (!m || query['openid.identity'] !== claimed) throw new LoginError('Ungültige Antwort (keine Steam-ID).');
  const signed = (query['openid.signed'] ?? '').split(',');
  for (const field of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle']) {
    if (!signed.includes(field)) throw new LoginError('Ungültige Antwort (unvollständig signiert).');
  }

  const nonce = query['openid.response_nonce'] ?? '';
  const nonceTime = Date.parse(nonce.slice(0, 20));
  if (!Number.isFinite(nonceTime) || Math.abs(now - nonceTime) > NONCE_MAX_AGE) throw new LoginError('Die Steam-Antwort ist abgelaufen. Bitte erneut anmelden.');
  run('DELETE FROM openid_nonces WHERE at < ?', now - 2 * NONCE_MAX_AGE);
  if (get('SELECT 1 FROM openid_nonces WHERE nonce = ?', nonce)) throw new LoginError('Diese Steam-Antwort wurde bereits benutzt.');

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.') && v != null) body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  const res = await fetchImpl(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok || !/^is_valid\s*:\s*true\s*$/m.test(text)) throw new LoginError('Steam hat den Login nicht bestätigt.');
  run('INSERT OR IGNORE INTO openid_nonces (nonce, at) VALUES (?, ?)', nonce, now);
  return m[1];
}

export interface SteamProfile {
  name: string;
  avatar: string | null;
}

/** Steam-Name und Avatar (nur mit STEAM_API_KEY; Fehler werden ignoriert). */
export async function fetchSteamProfile(steamId: string): Promise<SteamProfile | null> {
  if (!config.steamApiKey) return null;
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(config.steamApiKey)}&steamids=${steamId}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: { players?: { personaname?: string; avatarfull?: string }[] } };
    const p = json.response?.players?.[0];
    if (!p?.personaname) return null;
    const avatar = p.avatarfull && /^https:\/\/[a-z0-9.-]+\.steamstatic\.com\//i.test(p.avatarfull) ? p.avatarfull : null;
    return { name: p.personaname.slice(0, 64), avatar };
  } catch {
    return null;
  }
}
