// Startpunkt: Datenbank öffnen, Standard anlegen, Webserver und Hintergrund-Aktualisierung starten.

import { buildApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { seedStandard } from './board.js';
import { refreshDue } from './legion.js';
import { cleanupSessions } from './users.js';

openDb(config.dbPath);
seedStandard();

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
console.log(`AION2Tool läuft auf Port ${config.port} – öffentliche Adresse: ${config.publicUrl}`);
if (!config.ownerSteamIds.length) console.warn('⚠️  ADMIN_STEAM_IDS ist leer – niemand hat Admin-Rechte.');
if (config.devLogin) console.warn('⚠️  DEV_LOGIN ist an – Anmeldung ohne Steam möglich (nur lokal).');
if (config.devLoginIgnored) console.warn('⚠️  DEV_LOGIN wird ignoriert, weil PUBLIC_URL nicht auf localhost zeigt.');
if (!config.legionCheck) console.warn('⚠️  LEGION_CHECK ist aus – jeder Steam-Account hat Zugang.');

if (config.scheduler) {
  // Pro Minute bis zu 4 fällige Charaktere bei PlayNC abfragen (Werte + Legions-Prüfung des Mains)
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    refreshDue(4)
      .catch((e) => console.error('Hintergrund-Aktualisierung:', e))
      .finally(() => (busy = false));
  }, 60_000).unref();
  setInterval(cleanupSessions, 6 * 3_600_000).unref();
}

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
