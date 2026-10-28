// Zeitrechnung rund um Daily-/Weekly-Reset und Regenerations-Ticks.
// Alles wird über „Index“-Funktionen gelöst: Ein Reset liegt genau dort, wo sich der Index ändert.
// Dadurch zählt z. B. resetsBetween() korrekt, auch über Sommer-/Winterzeit-Wechsel hinweg.

import type { Period, ResetConfig } from './types.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// ---- Zeitzonen ----

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();
const BUCKET = 15 * MINUTE;

/**
 * Abstand Ortszeit − UTC in ms für die Zeitzone zum Zeitpunkt t.
 * Zeitumstellungen liegen in allen Zeitzonen auf einer Viertelstunde (UTC),
 * deshalb wird pro Viertelstunde einmal gerechnet und zwischengespeichert.
 */
export function tzOffset(t: number, tz: string): number {
  if (tz === 'UTC' || tz === 'Etc/UTC' || tz === 'GMT') return 0;
  const bucket = Math.floor(t / BUCKET);
  const key = `${tz}|${bucket}`;
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(tz, f);
  }
  const at = bucket * BUCKET;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - at;
  if (offsetCache.size > 5000) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/** „HH:MM“ → Minuten seit Mitternacht (null bei ungültiger Angabe). */
export function parseHM(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function resetMinutes(cfg: ResetConfig): number {
  return parseHM(cfg.time) ?? 0;
}

/** Ortszeit in ms, verschoben, sodass `minutes` (Uhrzeit) auf Mitternacht fällt. */
function shifted(t: number, tz: string, minutes: number): number {
  return t + tzOffset(t, tz) - minutes * MINUTE;
}

// ---- Resets ----

/** Laufende Nummer des „Spieltags“ (wechselt beim Daily-Reset). */
export function dayIndex(t: number, cfg: ResetConfig): number {
  return Math.floor(shifted(t, cfg.tz, resetMinutes(cfg)) / DAY);
}

/** Laufende Nummer des Zeitraums (wechselt beim jeweiligen Reset). */
export function periodIndex(t: number, period: Period, cfg: ResetConfig): number {
  const d = dayIndex(t, cfg);
  if (period === 'daily') return d;
  // Tag 0 (01.01.1970) war ein Donnerstag (Wochentag 4)
  const shift = (((cfg.weeklyDay - 4) % 7) + 7) % 7;
  return Math.floor((d - shift) / 7);
}

/** Anzahl der Resets im Zeitraum (a, b]. */
export function resetsBetween(a: number, b: number, period: Period, cfg: ResetConfig): number {
  return Math.max(0, periodIndex(b, period, cfg) - periodIndex(a, period, cfg));
}

/** Schlüssel des aktuellen Zeitraums – ändert sich mit jedem Reset. */
export function periodKey(t: number, period: Period, cfg: ResetConfig): string {
  return `${period}:${periodIndex(t, period, cfg)}`;
}

// ---- Regeneration ----

/**
 * Laufende Nummer des Regenerations-Ticks. Ticks liegen auf `anchor` (Uhrzeit in der Reset-Zeitzone)
 * plus Vielfachen des Intervalls; ohne Anker auf der Reset-Uhrzeit.
 */
export function tickIndex(t: number, intervalHours: number, cfg: ResetConfig, anchor?: string | null): number {
  const minutes = parseHM(anchor) ?? resetMinutes(cfg);
  return Math.floor(shifted(t, cfg.tz, minutes) / (Math.max(0.25, intervalHours) * HOUR));
}

export function ticksBetween(a: number, b: number, intervalHours: number, cfg: ResetConfig, anchor?: string | null): number {
  return Math.max(0, tickIndex(b, intervalHours, cfg, anchor) - tickIndex(a, intervalHours, cfg, anchor));
}

// ---- nächster Wechsel ----

/** Erster Zeitpunkt nach t, an dem sich index() ändert (Binärsuche auf die Millisekunde genau). */
function nextChange(t: number, span: number, index: (x: number) => number): number {
  const start = index(t);
  let lo = t;
  let hi = t + span;
  if (index(hi) === start) hi = t + span * 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (index(mid) === start) lo = mid;
    else hi = mid;
  }
  return hi;
}

const nextCache = new Map<string, { idx: number; next: number }>();

/** Wie nextChange, aber pro Zeitraum nur einmal gerechnet (viele Zellen fragen dasselbe). */
function cachedNext(key: string, t: number, span: number, index: (x: number) => number): number {
  const idx = index(t);
  const hit = nextCache.get(key);
  if (hit && hit.idx === idx && hit.next > t) return hit.next;
  const next = nextChange(t, span, index);
  if (nextCache.size > 500) nextCache.clear();
  nextCache.set(key, { idx, next });
  return next;
}

export function nextReset(t: number, period: Period, cfg: ResetConfig): number {
  const key = `r|${period}|${cfg.tz}|${cfg.time}|${cfg.weeklyDay}`;
  return cachedNext(key, t, (period === 'daily' ? 1 : 7) * DAY + 2 * HOUR, (x) => periodIndex(x, period, cfg));
}

export function nextTick(t: number, intervalHours: number, cfg: ResetConfig, anchor?: string | null): number {
  const key = `t|${intervalHours}|${anchor ?? ''}|${cfg.tz}|${cfg.time}`;
  return cachedNext(key, t, intervalHours * HOUR + 2 * HOUR, (x) => tickIndex(x, intervalHours, cfg, anchor));
}

export function periodLength(period: Period): number {
  return period === 'daily' ? DAY : 7 * DAY;
}

// ---- Anzeige ----

export const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** „3 T 4 Std.“, „5 Std. 12 Min.“, „12 Min.“ */
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'jetzt';
  const totalMin = Math.ceil(ms / MINUTE);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h ? `${d} T ${h} Std.` : `${d} T`;
  if (h > 0) return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
  return `${m} Min.`;
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function displayParts(t: number, timeZone?: string): { day: string; weekday: string; hm: string; date: string } {
  const key = timeZone ?? '';
  let f = displayFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    displayFormatters.set(key, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(t)) if (part.type !== 'literal') p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: (p.weekday ?? '').replace('.', ''), hm: `${p.hour}:${p.minute}`, date: `${p.day}.${p.month}.` };
}

/** Zeitpunkt in der Zeitzone des Betrachters, z. B. „heute 22:00“, „morgen 08:00“, „Mi 08:00“, „Mi 11.11. 08:00“. */
export function formatWhen(t: number, now: number, timeZone?: string): string {
  const x = displayParts(t, timeZone);
  if (x.day === displayParts(now, timeZone).day) return `heute ${x.hm}`;
  if (x.day === displayParts(now + DAY, timeZone).day) return `morgen ${x.hm}`;
  if (t - now < 6 * DAY && t > now) return `${x.weekday} ${x.hm}`;
  return `${x.weekday} ${x.date} ${x.hm}`;
}
