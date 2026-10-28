import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyDelta, compute, validateTask, warningsFor, type Ctx } from '../shared/engine.js';
import { dayIndex, formatWhen, nextReset, nextTick, periodIndex, resetsBetween, tzOffset } from '../shared/reset.js';
import { DEFAULT_PREFS, type ResetConfig, type TaskDef, type TaskState } from '../shared/types.js';

const UTC7: ResetConfig = { tz: 'UTC', time: '07:00', weeklyDay: 3 };
const BERLIN9: ResetConfig = { tz: 'Europe/Berlin', time: '09:00', weeklyDay: 3 };
const at = (iso: string) => Date.parse(iso);
const st = (value: number, when: string, bonus = 0, charId = 1): TaskState => ({ taskId: 1, charId, value, bonus, at: at(when) });

function task(partial: Partial<TaskDef>): TaskDef {
  return { id: 1, ownerId: null, name: 'Test', icon: '✅', kind: 'quota', scope: 'character', section: 'daily', params: {}, note: '', sort: 0, active: true, defaultOn: true, ...partial };
}

const odyl = task({ kind: 'regen', params: { amount: 15, intervalHours: 3, cap: 560, capAbo: 840, bonusCap: 2000 } });
const nightmare = task({ kind: 'stack', params: { period: 'daily', amount: 2, cap: 14, bonusCap: 30 } });
const shugo = task({ kind: 'stack', scope: 'account', params: { period: 'daily', amount: 3, cap: 12, capAbo: 21 } });
const dungeon = task({ kind: 'quota', scope: 'account', section: 'weekly', params: { period: 'weekly', amount: 14 } });
const ctx = (iso: string, abo = false): Ctx => ({ now: at(iso), abo, reset: UTC7 });

describe('Reset-Rechnung', () => {
  it('Daily-Reset 07:00 UTC', () => {
    assert.equal(resetsBetween(at('2026-10-28T06:59:00Z'), at('2026-10-28T07:00:00Z'), 'daily', UTC7), 1);
    assert.equal(resetsBetween(at('2026-10-28T07:00:00Z'), at('2026-10-29T06:59:59Z'), 'daily', UTC7), 0);
    assert.equal(resetsBetween(at('2026-10-20T12:00:00Z'), at('2026-10-28T12:00:00Z'), 'daily', UTC7), 8);
    assert.equal(nextReset(at('2026-10-28T19:30:00Z'), 'daily', UTC7), at('2026-10-29T07:00:00Z'));
    // Zwischenspeicher liefert für spätere Zeitpunkte desselben Tages dasselbe Ergebnis
    assert.equal(nextReset(at('2026-10-29T06:59:59Z'), 'daily', UTC7), at('2026-10-29T07:00:00Z'));
    assert.equal(nextReset(at('2026-10-29T07:00:00Z'), 'daily', UTC7), at('2026-10-30T07:00:00Z'));
  });

  it('Weekly-Reset Mittwoch 07:00 UTC', () => {
    // 28.10.2026 ist ein Mittwoch
    assert.equal(new Date(at('2026-10-28T00:00:00Z')).getUTCDay(), 3);
    assert.equal(resetsBetween(at('2026-10-28T06:00:00Z'), at('2026-10-28T08:00:00Z'), 'weekly', UTC7), 1);
    assert.equal(resetsBetween(at('2026-10-28T08:00:00Z'), at('2026-11-04T06:59:00Z'), 'weekly', UTC7), 0);
    assert.equal(nextReset(at('2026-10-28T08:00:00Z'), 'weekly', UTC7), at('2026-11-04T07:00:00Z'));
    assert.equal(nextReset(at('2026-10-27T08:00:00Z'), 'weekly', UTC7), at('2026-10-28T07:00:00Z'));
  });

  it('Zeitzone Berlin inkl. Zeitumstellung', () => {
    assert.equal(tzOffset(at('2026-07-01T12:00:00Z'), 'Europe/Berlin'), 2 * 3_600_000);
    assert.equal(tzOffset(at('2026-12-01T12:00:00Z'), 'Europe/Berlin'), 3_600_000);
    // Umstellung am 25.10.2026 um 01:00 UTC
    assert.equal(tzOffset(at('2026-10-25T00:59:59Z'), 'Europe/Berlin'), 2 * 3_600_000);
    assert.equal(tzOffset(at('2026-10-25T01:00:00Z'), 'Europe/Berlin'), 3_600_000);
    // 09:00 Berlin = 07:00 UTC im Sommer, 08:00 UTC im Winter
    assert.equal(nextReset(at('2026-07-01T12:00:00Z'), 'daily', BERLIN9), at('2026-07-02T07:00:00Z'));
    assert.equal(nextReset(at('2026-12-01T12:00:00Z'), 'daily', BERLIN9), at('2026-12-02T08:00:00Z'));
    assert.equal(resetsBetween(at('2026-10-24T12:00:00Z'), at('2026-10-26T12:00:00Z'), 'daily', BERLIN9), 2);
    assert.equal(dayIndex(at('2026-10-25T07:30:00Z'), BERLIN9), dayIndex(at('2026-10-25T08:30:00Z'), BERLIN9) - 1);
  });

  it('Regenerations-Ticks alle 3 Std. ab dem Reset oder ab einer eigenen Uhrzeit', () => {
    assert.equal(nextTick(at('2026-10-28T07:30:00Z'), 3, UTC7), at('2026-10-28T10:00:00Z'));
    assert.equal(nextTick(at('2026-10-28T06:59:00Z'), 3, UTC7), at('2026-10-28T07:00:00Z'));
    assert.equal(nextTick(at('2026-10-28T07:30:00Z'), 3, UTC7, '00:00'), at('2026-10-28T09:00:00Z'));
    assert.equal(nextTick(at('2026-10-28T07:30:00Z'), 3, UTC7, '01:30'), at('2026-10-28T07:30:00Z') + 3 * 3_600_000);
    assert.equal(periodIndex(at('2026-10-28T07:00:00Z'), 'daily', UTC7) - periodIndex(at('2026-10-28T06:59:00Z'), 'daily', UTC7), 1);
  });

  it('Anzeige von Zeitpunkten', () => {
    const now = at('2026-10-28T10:00:00Z');
    assert.equal(formatWhen(at('2026-10-28T22:00:00Z'), now, 'UTC'), 'heute 22:00');
    assert.equal(formatWhen(at('2026-10-29T07:00:00Z'), now, 'UTC'), 'morgen 07:00');
    assert.equal(formatWhen(at('2026-11-02T07:00:00Z'), now, 'UTC'), 'Mo 07:00');
    assert.equal(formatWhen(at('2026-11-11T07:00:00Z'), now, 'UTC'), 'Mi 11.11. 07:00');
  });
});

describe('Zähler', () => {
  it('Odyl regeneriert +15 alle 3 Std. bis 560 bzw. 840 mit Abo', () => {
    const s = st(500, '2026-10-28T07:30:00Z');
    assert.equal(compute(odyl, s, ctx('2026-10-28T09:59:00Z')).value, 500);
    assert.equal(compute(odyl, s, ctx('2026-10-28T10:00:00Z')).value, 515);
    assert.equal(compute(odyl, s, ctx('2026-10-29T10:00:00Z')).value, 560);
    // 9 Ticks bis 10:00 am Folgetag
    assert.equal(compute(odyl, s, ctx('2026-10-29T10:00:00Z', true)).value, 635);
    // wann voll: 60 fehlen → 4 Ticks → 10:00 + 3 × 3 Std. = 19:00
    assert.equal(compute(odyl, s, ctx('2026-10-28T08:00:00Z')).fullAt, at('2026-10-28T19:00:00Z'));
  });

  it('über dem Maximum (Abo abgelaufen) wird nicht weiter regeneriert und nicht gekürzt', () => {
    const s = st(800, '2026-10-28T07:30:00Z');
    assert.equal(compute(odyl, s, ctx('2026-10-30T07:30:00Z')).value, 800);
    const w = warningsFor(odyl, compute(odyl, s, ctx('2026-10-30T07:30:00Z')), ctx('2026-10-30T07:30:00Z'), DEFAULT_PREFS);
    assert.ok(w.some((x) => x.level === 'info' && /ohne Abo/.test(x.text)));
  });

  it('Albtraum stapelt +2 pro Tag bis 14', () => {
    const s = st(10, '2026-10-28T08:00:00Z');
    assert.equal(compute(nightmare, s, ctx('2026-10-29T07:00:00Z')).value, 12);
    assert.equal(compute(nightmare, s, ctx('2026-10-31T07:00:00Z')).value, 14);
  });

  it('Shugo-Schlüssel: Maximum 12, mit Abo 21', () => {
    const s = st(11, '2026-10-28T08:00:00Z', 0, 0);
    assert.equal(compute(shugo, s, ctx('2026-10-29T08:00:00Z')).value, 12);
    assert.equal(compute(shugo, s, ctx('2026-10-29T08:00:00Z', true)).value, 14);
  });

  it('Kontingent wird beim Weekly-Reset wieder voll, Rest verfällt', () => {
    assert.equal(compute(dungeon, undefined, ctx('2026-10-28T08:00:00Z')).value, 14);
    const s = st(3, '2026-10-28T08:00:00Z', 0, 0);
    assert.equal(compute(dungeon, s, ctx('2026-11-04T06:59:00Z')).value, 3);
    assert.equal(compute(dungeon, s, ctx('2026-11-04T07:00:00Z')).value, 14);
  });

  it('Minus nie unter 0; ohne Extra-Vorrat landet Plus im normalen Stand', () => {
    const s = st(1, '2026-10-28T08:00:00Z', 0, 0);
    assert.deepEqual(applyDelta(shugo, s, -5, ctx('2026-10-28T09:00:00Z')), { value: 0, bonus: 0 });
    assert.deepEqual(applyDelta(shugo, s, 20, ctx('2026-10-28T09:00:00Z')), { value: 21, bonus: 0 });
  });
});

describe('Extra-Vorrat (Items)', () => {
  it('Plus füllt den Extra-Vorrat bis zu seinem Maximum', () => {
    const s = st(10, '2026-10-28T08:00:00Z');
    assert.deepEqual(applyDelta(nightmare, s, 5, ctx('2026-10-28T09:00:00Z')), { value: 10, bonus: 5 });
    assert.deepEqual(applyDelta(nightmare, st(10, '2026-10-28T08:00:00Z', 28), 5, ctx('2026-10-28T09:00:00Z')), { value: 10, bonus: 30 });
  });

  it('verbraucht zuerst den natürlichen Vorrat, dann den Extra-Vorrat', () => {
    const s = st(2, '2026-10-28T08:00:00Z', 5);
    assert.deepEqual(applyDelta(nightmare, s, -1, ctx('2026-10-28T09:00:00Z')), { value: 1, bonus: 5 });
    assert.deepEqual(applyDelta(nightmare, s, -4, ctx('2026-10-28T09:00:00Z')), { value: 0, bonus: 3 });
    assert.deepEqual(applyDelta(odyl, st(20, '2026-10-28T08:00:00Z', 40), -40, ctx('2026-10-28T08:30:00Z')), { value: 0, bonus: 20 });
  });

  it('der natürliche Vorrat füllt sich weiter auf, auch wenn Extra-Tickets da sind', () => {
    const s = st(10, '2026-10-28T08:00:00Z', 5);
    const c = compute(nightmare, s, ctx('2026-10-29T08:00:00Z'));
    assert.equal(c.value, 12);
    assert.equal(c.bonus, 5);
  });

  it('Überlauf-Warnung zählt nur den natürlichen Vorrat', () => {
    // 10 natürliche + 5 Extra: morgen +2 → 12, nichts verfällt
    const c1 = ctx('2026-10-28T09:00:00Z');
    assert.equal(warningsFor(nightmare, compute(nightmare, st(10, '2026-10-28T08:00:00Z', 5), c1), c1, DEFAULT_PREFS).length, 0);
    // 14 natürliche + 5 Extra: morgen verfallen 2
    const w = warningsFor(nightmare, compute(nightmare, st(14, '2026-10-28T08:00:00Z', 5), c1), c1, DEFAULT_PREFS);
    assert.equal(w[0].level, 'danger');
    assert.match(w[0].text, /14\/14 · \+5 Extra/);
    assert.match(w[0].text, /verfallen 2/);
  });

  it('Extra-Vorrat wird ignoriert, wenn der Eintrag keinen hat', () => {
    const c = compute(shugo, st(5, '2026-10-28T08:00:00Z', 9, 0), ctx('2026-10-28T09:00:00Z'));
    assert.equal(c.bonus, 0);
  });
});

describe('Warnungen', () => {
  it('Albtraum: warnt, wenn beim nächsten Reset Tickets verfallen', () => {
    const c = ctx('2026-10-28T09:00:00Z');
    const w = warningsFor(nightmare, compute(nightmare, st(13, '2026-10-28T08:00:00Z'), c), c, DEFAULT_PREFS);
    assert.equal(w.length, 1);
    assert.equal(w[0].level, 'warn');
    assert.match(w[0].text, /verfallen 1/);
    assert.equal(warningsFor(nightmare, compute(nightmare, st(14, '2026-10-28T08:00:00Z'), c), c, DEFAULT_PREFS)[0].level, 'danger');
    assert.equal(warningsFor(nightmare, compute(nightmare, st(12, '2026-10-28T08:00:00Z'), c), c, DEFAULT_PREFS).length, 0);
  });

  it('Odyl: warnt, wenn bald voll', () => {
    const c = ctx('2026-10-28T08:00:00Z');
    assert.match(warningsFor(odyl, compute(odyl, st(500, '2026-10-28T07:30:00Z'), c), c, DEFAULT_PREFS)[0].text, /voll/);
    assert.equal(warningsFor(odyl, compute(odyl, st(0, '2026-10-28T07:30:00Z'), c), c, DEFAULT_PREFS).length, 0);
  });

  it('Wochen-Kontingent: warnt 24 Std. vor dem Reset, wenn noch etwas übrig ist', () => {
    const s = st(4, '2026-10-28T08:00:00Z', 0, 0);
    const early = ctx('2026-11-02T12:00:00Z');
    const late = ctx('2026-11-03T12:00:00Z');
    assert.equal(warningsFor(dungeon, compute(dungeon, s, early), early, DEFAULT_PREFS).length, 0);
    assert.match(warningsFor(dungeon, compute(dungeon, s, late), late, DEFAULT_PREFS)[0].text, /noch 4 übrig/);
  });

  it('keine Warnung ohne eingetragenen Stand oder wenn abgeschaltet', () => {
    const c = ctx('2026-10-28T08:00:00Z');
    assert.equal(warningsFor(odyl, compute(odyl, undefined, c), c, DEFAULT_PREFS).length, 0);
    const quiet = task({ ...nightmare, params: { ...nightmare.params, warn: false } });
    assert.equal(warningsFor(quiet, compute(quiet, st(14, '2026-10-28T08:00:00Z'), c), c, DEFAULT_PREFS).length, 0);
  });
});

describe('Prüfung von Einträgen', () => {
  it('erkennt fehlende oder ungültige Werte', () => {
    const base = { name: 'X', scope: 'character' as const, section: 'daily' as const };
    assert.match(validateTask({ ...base, kind: 'regen', params: { amount: 1, cap: 10 } })!, /Intervall/);
    assert.match(validateTask({ ...base, kind: 'regen', params: { amount: 1, cap: 10, intervalHours: 3, anchor: '25:00' } })!, /HH:MM/);
    assert.equal(validateTask({ ...base, name: ' ', kind: 'check', params: {} }), 'Bitte einen Namen angeben.');
    assert.equal(validateTask({ ...base, kind: 'action', params: { actions: [] } }), 'Bitte mindestens einen Knopf anlegen.');
    assert.match(validateTask({ ...base, kind: 'action', params: { actions: [{ id: 'a', label: 'x', effects: [{ taskId: 1, delta: 0 }] }] } })!, /ungleich 0/);
    assert.equal(validateTask({ ...base, kind: 'quota', scope: 'account', section: 'weekly', params: { amount: 3 } }), null);
  });
});
