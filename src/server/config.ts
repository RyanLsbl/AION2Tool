// Lädt die .env-Datei (falls vorhanden) und stellt alle Konfigurationswerte bereit.
try {
  process.loadEnvFile();
} catch {
  // keine .env vorhanden – Umgebungsvariablen werden direkt verwendet
}

const env = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const onOff = (key: string, fallback: 'an' | 'aus'): boolean => env(key, fallback).toLowerCase() === 'an';

const publicUrl = env('PUBLIC_URL', 'http://localhost:3000').replace(/\/+$/, '');
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl);

export const config = {
  port: Number(env('PORT', '3000')) || 3000,
  host: env('HOST', '0.0.0.0'),
  /** Öffentliche Adresse, unter der das Tool erreichbar ist (für den Steam-Login), z. B. https://aion2.domain.de */
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  dbPath: env('DB_PATH', './data/aion2tool.sqlite'),
  /** Optional: Steam-Web-API-Key für Steam-Name und Avatar */
  steamApiKey: env('STEAM_API_KEY'),
  /** Haupt-Admins (Steam-IDs, mit Komma getrennt) */
  ownerSteamIds: env('ADMIN_STEAM_IDS')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{17}$/.test(s)),
  aion: {
    /** PlayNC-Region: nae, naw, eu, la, as */
    region: env('AION_REGION', 'eu'),
    server: env('AION_SERVER', 'Ishtar'),
    /** Ishtar (Elyos, EU) = 1319 – laut PlayNC-Charaktersuche */
    serverId: Number(env('AION_SERVER_ID', '1319')) || 0,
    legion: env('AION_LEGION', 'Altersheim'),
  },
  reset: {
    tz: env('RESET_TIMEZONE', 'UTC'),
    time: env('RESET_TIME', '07:00'),
    /** 0 = Sonntag … 3 = Mittwoch */
    weeklyDay: Math.min(6, Math.max(0, Number(env('RESET_WEEKDAY', '3')) || 0)),
  },
  /** Legions-Prüfung über PlayNC (aus = jeder Steam-Login hat Zugang, nur zum Testen) */
  legionCheck: onOff('LEGION_CHECK', 'an'),
  /** Test-Login ohne Steam – nur für lokale Entwicklung und nur, wenn PUBLIC_URL auf localhost zeigt */
  devLogin: onOff('DEV_LOGIN', 'aus') && isLocal,
  devLoginIgnored: onOff('DEV_LOGIN', 'aus') && !isLocal,
  /** Intervall der Hintergrund-Aktualisierung bei PlayNC (Stunden) */
  refreshHours: Math.max(1, Number(env('REFRESH_HOURS', '6')) || 6),
  /** Hintergrund-Abfragen bei PlayNC (aus z. B. in Tests) */
  scheduler: onOff('SCHEDULER', 'an'),
};

export type Config = typeof config;
