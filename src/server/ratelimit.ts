// Einfache Begrenzung pro Schlüssel (z. B. „wie oft darf ein User PlayNC-Abfragen auslösen“).

import { UserError } from './legion.js';

const hits = new Map<string, number[]>();

/** Wirft 429, wenn `key` im Zeitfenster schon `max`-mal benutzt wurde. */
export function rateLimit(key: string, max: number, windowMs: number, message = 'Zu viele Anfragen – bitte kurz warten.'): void {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new UserError(message, 429);
  list.push(now);
  if (hits.size > 10_000) hits.clear();
  hits.set(key, list);
}

export function resetRateLimits(): void {
  hits.clear();
}
