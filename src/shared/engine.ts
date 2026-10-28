// Rechnet Zählerstände hoch und erzeugt Warnungen.
// Gespeichert wird nur „Stand zum Zeitpunkt at“; alles andere wird aus den Regeln berechnet.
//
// Regeneration/Tickets haben zwei Töpfe (wie im Spiel):
// - natürlicher Vorrat: wird automatisch bis zum Maximum aufgefüllt
// - Extra-Vorrat (optional): aus Items/Inhalten, wird nie aufgefüllt, verfällt nicht und wird erst nach dem natürlichen verbraucht

import { formatDuration, formatWhen, HOUR, nextReset, nextTick, periodLength, resetsBetween, ticksBetween } from './reset.js';
import type { Period, Prefs, ResetConfig, TaskDef, TaskState } from './types.js';

export interface Ctx {
  now: number;
  abo: boolean;
  reset: ResetConfig;
}

export interface Computed {
  /** natürlicher Vorrat bzw. Rest des Kontingents; null = noch nie eingetragen (Zähler ohne Startwert) */
  value: number | null;
  /** Extra-Vorrat (0, wenn es keinen gibt) */
  bonus: number;
  /** natürliches Maximum (regen/stack) bzw. Kontingent (quota/check) */
  max: number | null;
  /** nächster Nachschub/Reset */
  nextAt: number | null;
  /** Menge beim nächsten Nachschub (regen/stack) */
  nextGain: number | null;
  /** regen/stack: wann das Maximum erreicht ist (null = schon voll oder nie) */
  fullAt: number | null;
}

export interface Warning {
  level: 'danger' | 'warn' | 'info';
  text: string;
}

const num = (v: number | null | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function periodOf(t: TaskDef): Period {
  if (t.kind === 'regen') return 'daily';
  return t.params.period ?? (t.section === 'weekly' ? 'weekly' : 'daily');
}

/** Hat der Eintrag einen Extra-Vorrat? */
export function hasBonus(t: TaskDef): boolean {
  return (t.kind === 'regen' || t.kind === 'stack') && num(t.params.bonusCap, 0) > 0;
}

/** Maximum, bis zu dem natürlich aufgefüllt wird (regen/stack) bzw. Kontingent (quota/check). */
export function maxOf(t: TaskDef, abo: boolean): number | null {
  const p = t.params;
  switch (t.kind) {
    case 'regen':
    case 'stack':
      return abo && p.capAbo != null ? p.capAbo : num(p.cap, 0);
    case 'quota':
      return abo && p.amountAbo != null ? p.amountAbo : num(p.amount, 1);
    case 'check':
      return 1;
    case 'action':
      return null;
  }
}

/** Menge pro Nachschub (regen/stack). */
export function gainOf(t: TaskDef, abo: boolean): number {
  const p = t.params;
  return abo && p.amountAbo != null ? p.amountAbo : num(p.amount, 0);
}

/** Startwert, wenn noch nie etwas eingetragen wurde. */
function initialValue(t: TaskDef, abo: boolean): number | null {
  switch (t.kind) {
    case 'quota':
    case 'check':
      return maxOf(t, abo);
    case 'action':
      return 0;
    default:
      return null;
  }
}

/** Verfügbar insgesamt (natürlich + Extra). */
export function available(c: Computed): number {
  return (c.value ?? 0) + c.bonus;
}

export function compute(t: TaskDef, s: TaskState | undefined, ctx: Ctx): Computed {
  const max = maxOf(t, ctx.abo);
  const out: Computed = { value: null, bonus: 0, max, nextAt: null, nextGain: null, fullAt: null };
  if (s && hasBonus(t)) out.bonus = Math.max(0, num(s.bonus, 0));

  if (t.kind === 'regen') {
    const interval = Math.max(0.25, num(t.params.intervalHours, 3));
    const gain = gainOf(t, ctx.abo);
    out.nextAt = nextTick(ctx.now, interval, ctx.reset, t.params.anchor);
    out.nextGain = gain;
    if (!s) return out;
    const cap = max ?? 0;
    const ticks = ticksBetween(s.at, ctx.now, interval, ctx.reset, t.params.anchor);
    const v = s.value >= cap ? s.value : Math.min(cap, s.value + ticks * gain);
    out.value = v;
    if (v < cap && gain > 0) out.fullAt = out.nextAt + (Math.ceil((cap - v) / gain) - 1) * interval * HOUR;
    return out;
  }

  const period = periodOf(t);
  out.nextAt = nextReset(ctx.now, period, ctx.reset);

  if (t.kind === 'stack') {
    const gain = gainOf(t, ctx.abo);
    out.nextGain = gain;
    if (!s) return out;
    const cap = max ?? 0;
    const n = resetsBetween(s.at, ctx.now, period, ctx.reset);
    const v = s.value >= cap ? s.value : Math.min(cap, s.value + n * gain);
    out.value = v;
    if (v < cap && gain > 0) out.fullAt = out.nextAt + (Math.ceil((cap - v) / gain) - 1) * periodLength(period);
    return out;
  }

  // quota / check / action: beim Reset zurück auf den Startwert
  const fresh = initialValue(t, ctx.abo) ?? 0;
  if (!s) {
    out.value = fresh;
    return out;
  }
  const n = resetsBetween(s.at, ctx.now, period, ctx.reset);
  if (n === 0) out.value = s.value;
  else if (t.kind === 'quota') out.value = Math.max(s.value, fresh); // Zugaben über das Kontingent hinaus bleiben
  else out.value = fresh;
  return out;
}

export function roundValue(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Neuer Stand nach einer Änderung um delta.
 * - Abziehen: erst vom natürlichen Vorrat, dann vom Extra-Vorrat (nie unter 0)
 * - Hinzufügen: in den Extra-Vorrat (bis bonusCap), ohne Extra-Vorrat in den normalen Stand
 */
export function applyDelta(t: TaskDef, s: TaskState | undefined, delta: number, ctx: Ctx): { value: number; bonus: number } {
  const c = compute(t, s, ctx);
  let value = c.value ?? 0;
  let bonus = c.bonus;
  if (t.kind === 'check') return { value: Math.min(1, Math.max(0, value + delta)), bonus: 0 };
  if (delta < 0) {
    const need = -delta;
    const fromValue = Math.min(value, need);
    value -= fromValue;
    bonus = Math.max(0, bonus - (need - fromValue));
  } else if (hasBonus(t)) {
    bonus = Math.max(bonus, Math.min(num(t.params.bonusCap, 0), bonus + delta));
  } else {
    value += delta;
  }
  return { value: roundValue(Math.max(0, value)), bonus: roundValue(Math.max(0, bonus)) };
}

/** Ist der Eintrag für diesen Charakter (Stufe) verfügbar? */
export function levelOk(t: TaskDef, level: number | null | undefined): boolean {
  const min = t.params.minLevel;
  return !min || level == null || level >= min;
}

export function fmtNum(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('de-DE') : v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

export function warningsFor(t: TaskDef, c: Computed, ctx: Ctx, prefs: Prefs): Warning[] {
  if (t.params.warn === false || c.value == null) return [];
  const out: Warning[] = [];
  const v = c.value;
  const unit = t.params.unit ? ` ${t.params.unit}` : '';
  const fmt = (x: number) => `${fmtNum(x)}${unit}`;
  const extra = c.bonus > 0 ? ` · +${fmtNum(c.bonus)} Extra` : '';

  if (t.kind === 'regen' && c.max != null) {
    if (v >= c.max) {
      out.push({ level: 'danger', text: `voll (${fmt(v)}/${fmtNum(c.max)}${extra}) – die Regeneration verfällt` });
    } else if (c.fullAt != null && c.fullAt - ctx.now <= prefs.warnRegenHours * HOUR) {
      out.push({ level: 'warn', text: `${fmt(v)}/${fmtNum(c.max)} – in ${formatDuration(c.fullAt - ctx.now)} voll (${formatWhen(c.fullAt, ctx.now)})` });
    }
  }

  if (t.kind === 'stack' && c.max != null && c.nextAt != null) {
    const gain = c.nextGain ?? 0;
    const lost = v >= c.max ? gain : Math.max(0, v + gain - c.max);
    if (lost > 0) {
      const when = periodOf(t) === 'daily' ? 'beim nächsten Reset' : 'beim Weekly-Reset';
      out.push({
        level: lost >= gain ? 'danger' : 'warn',
        text: `${fmt(v)}/${fmtNum(c.max)}${extra} – ${when} (${formatWhen(c.nextAt, ctx.now)}) verfallen ${fmt(lost)}`,
      });
    }
  }

  if ((t.kind === 'regen' || t.kind === 'stack') && !ctx.abo && t.params.capAbo != null && c.max != null && v > c.max) {
    out.push({ level: 'info', text: `${fmt(v)} liegt über dem Maximum ohne Abo (${fmtNum(c.max)}) – kein Nachschub, bis du darunter bist` });
  }

  if ((t.kind === 'quota' || t.kind === 'check') && c.nextAt != null && v > 0) {
    const hours = periodOf(t) === 'daily' ? prefs.warnDailyHours : prefs.warnWeeklyHours;
    if (hours > 0 && c.nextAt - ctx.now <= hours * HOUR) {
      const text =
        t.kind === 'check'
          ? `noch nicht erledigt – Reset in ${formatDuration(c.nextAt - ctx.now)}`
          : `noch ${fmt(v)} übrig – verfällt in ${formatDuration(c.nextAt - ctx.now)} (${formatWhen(c.nextAt, ctx.now)})`;
      out.push({ level: 'warn', text });
    }
  }
  return out;
}

/** Prüft die Regeln eines Eintrags; gibt eine Fehlermeldung oder null zurück. */
export function validateTask(t: Pick<TaskDef, 'name' | 'kind' | 'scope' | 'section' | 'params'>): string | null {
  if (!t.name.trim()) return 'Bitte einen Namen angeben.';
  if (t.name.length > 60) return 'Der Name darf höchstens 60 Zeichen lang sein.';
  const p = t.params;
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const nonNeg = (v: unknown) => v == null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (t.kind === 'regen') {
    if (!pos(p.intervalHours) || (p.intervalHours ?? 0) < 0.25) return 'Das Intervall muss mindestens 0,25 Stunden sein.';
    if (!pos(p.amount)) return 'Die Menge pro Intervall muss größer als 0 sein.';
    if (!pos(p.cap)) return 'Das Maximum muss größer als 0 sein.';
    if (p.anchor && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(p.anchor)) return 'Die Tick-Uhrzeit bitte als HH:MM angeben (z. B. 01:00).';
  }
  if (t.kind === 'stack') {
    if (!pos(p.amount)) return 'Die Menge pro Reset muss größer als 0 sein.';
    if (!pos(p.cap)) return 'Das Maximum muss größer als 0 sein.';
  }
  if (t.kind === 'quota' && !pos(p.amount)) return 'Das Kontingent muss größer als 0 sein.';
  for (const v of [p.capAbo, p.amountAbo, p.bonusCap, p.minLevel, p.step]) if (!nonNeg(v)) return 'Zahlen dürfen nicht negativ sein.';
  for (const v of [p.amount, p.cap, p.capAbo, p.amountAbo, p.bonusCap]) if (typeof v === 'number' && v > 1_000_000) return 'Zahlen höchstens 1.000.000.';
  if (t.kind === 'action') {
    const acts = p.actions ?? [];
    if (!acts.length) return 'Bitte mindestens einen Knopf anlegen.';
    if (acts.length > 6) return 'Höchstens 6 Knöpfe.';
    for (const a of acts) {
      if (!a.label.trim()) return 'Jeder Knopf braucht eine Beschriftung.';
      if (a.label.length > 30) return 'Knopf-Beschriftungen höchstens 30 Zeichen.';
      if (a.effects.length > 4) return 'Höchstens 4 Wirkungen pro Knopf.';
      for (const e of a.effects) {
        if (!Number.isInteger(e.taskId) || !Number.isFinite(e.delta) || e.delta === 0 || Math.abs(e.delta) > 100_000) return 'Jede Wirkung braucht ein Ziel und eine Zahl ungleich 0.';
      }
    }
  }
  return null;
}
