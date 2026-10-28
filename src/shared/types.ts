// Gemeinsame Typen für Server und Oberfläche.

/**
 * Arten von Einträgen im Builder:
 * - regen:  Zähler, der alle X Stunden um eine Menge wächst (z. B. Odyl-Energie +15 alle 3 Std.)
 * - stack:  Zähler, der bei jedem Reset um eine Menge wächst und sich bis zum Maximum stapelt (z. B. Albtraum +2/Tag, max. 14)
 * - quota:  Kontingent, das bei jedem Reset wieder aufgefüllt wird; Rest verfällt (z. B. Tägliches Dungeon 14/Woche)
 * - check:  einfacher Haken, der bei jedem Reset zurückgesetzt wird
 * - action: Knöpfe, die andere Zähler verändern (z. B. Expedition mit Belohnung: −40 Odyl); zählt die Nutzungen pro Zeitraum
 */
export type Kind = 'regen' | 'stack' | 'quota' | 'check' | 'action';
export type Period = 'daily' | 'weekly';
/** character = jeder Charakter hat einen eigenen Stand; account = ein Stand für alle Charaktere auf dem Server */
export type Scope = 'character' | 'account';
export type Section = 'daily' | 'weekly';

export interface ActionEffect {
  taskId: number;
  delta: number;
}

export interface ActionDef {
  id: string;
  label: string;
  /** nur sichtbar, wenn der User das Abo eingeschaltet hat */
  aboOnly?: boolean;
  effects: ActionEffect[];
}

export interface TaskParams {
  /** stack/quota/check/action: Zeitraum des Nachschubs bzw. Zurücksetzens */
  period?: Period;
  /** regen: Menge pro Intervall · stack: Menge pro Reset · quota: Kontingent pro Reset */
  amount?: number;
  /** quota: Kontingent mit Abo · stack/regen: Menge mit Abo (leer = wie ohne Abo) */
  amountAbo?: number | null;
  /** regen: Intervall in Stunden */
  intervalHours?: number;
  /** regen/stack: Maximum, bis zu dem natürlich aufgefüllt wird */
  cap?: number;
  /** regen/stack: Maximum mit Abo (leer = wie ohne Abo) */
  capAbo?: number | null;
  /**
   * regen/stack: Extra-Vorrat aus Items/Inhalten (z. B. Albtraum bis 30 zusätzlich).
   * Wird nicht natürlich aufgefüllt, zählt nicht gegen das Maximum und wird erst nach dem natürlichen Vorrat verbraucht.
   * leer = kein Extra-Vorrat (Zugaben landen im normalen Stand)
   */
  bonusCap?: number | null;
  /** regen: Uhrzeit eines Ticks („HH:MM“ in der Reset-Zeitzone); leer = Reset-Uhrzeit */
  anchor?: string | null;
  /** Einheit für die Anzeige, z. B. „Std.“ */
  unit?: string;
  /** Schrittweite des Minus-Knopfs (Standard 1) */
  step?: number;
  /** erst ab dieser Charakterstufe */
  minLevel?: number | null;
  /** Warnungen für diesen Eintrag (Standard: an) */
  warn?: boolean;
  /** action: Knöpfe */
  actions?: ActionDef[];
}

export interface TaskDef {
  id: number;
  /** null = Standard der Legion, sonst Eigentümer */
  ownerId: number | null;
  name: string;
  icon: string;
  kind: Kind;
  scope: Scope;
  section: Section;
  params: TaskParams;
  note: string;
  sort: number;
  active: boolean;
  /** Standard: neuen Mitgliedern automatisch hinzufügen */
  defaultOn: boolean;
}

export interface BoardItem {
  taskId: number;
  sort: number;
  hidden: boolean;
  /** Charaktere, bei denen der Eintrag ausgeblendet ist */
  offChars: number[];
  /** Warnungen für diesen Eintrag stummgeschaltet */
  muted: boolean;
}

export interface TaskState {
  taskId: number;
  /** 0 = Account (server-weit) */
  charId: number;
  /** natürlicher Vorrat bzw. Kontingent/Haken/Nutzungen */
  value: number;
  /** Extra-Vorrat (nur regen/stack mit bonusCap) */
  bonus: number;
  /** Zeitpunkt (ms), zu dem `value` galt – ab hier wird hochgerechnet */
  at: number;
}

export interface ResetConfig {
  /** IANA-Zeitzone, z. B. "UTC" oder "Europe/Berlin" */
  tz: string;
  /** Uhrzeit des Daily-Resets in dieser Zeitzone, "HH:MM" */
  time: string;
  /** Wochentag des Weekly-Resets, 0 = Sonntag … 3 = Mittwoch … 6 = Samstag */
  weeklyDay: number;
}

export interface Prefs {
  /** Warnen, wenn eine Regeneration (Odyl) in so vielen Stunden voll ist */
  warnRegenHours: number;
  /** Warnen, wenn ein Tages-Kontingent/Haken so viele Stunden vor dem Reset noch offen ist (0 = aus) */
  warnDailyHours: number;
  /** Warnen, wenn ein Wochen-Kontingent/Haken so viele Stunden vor dem Weekly-Reset noch offen ist (0 = aus) */
  warnWeeklyHours: number;
}

export const DEFAULT_PREFS: Prefs = { warnRegenHours: 12, warnDailyHours: 0, warnWeeklyHours: 24 };

export interface Character {
  id: number;
  name: string;
  isMain: boolean;
  className: string | null;
  classKey: string | null;
  level: number | null;
  combatPower: number | null;
  itemLevel: number | null;
  legion: string | null;
  race: string | null;
  armoryAt: number | null;
  armoryError: string | null;
  sort: number;
}

export type Access = 'ok' | 'needs-main' | 'pending' | 'left' | 'blocked';

export interface Me {
  id: number;
  steamId: string;
  name: string;
  avatar: string | null;
  isOfficer: boolean;
  isOwner: boolean;
  abo: boolean;
  prefs: Prefs;
  access: Access;
  /** Einrichtungs-Assistent abgeschlossen oder übersprungen */
  tutorialDone: boolean;
  /** was PlayNC zuletzt als Legion des Mains gemeldet hat */
  legionSeen: string | null;
  legionCheckedAt: number | null;
  characters: Character[];
}

export interface AppInfo {
  legion: string;
  server: string;
  reset: ResetConfig;
  devLogin: boolean;
}

export const KIND_LABEL: Record<Kind, string> = {
  regen: 'Regeneration (alle X Std.)',
  stack: 'Stapelnde Tickets (pro Reset)',
  quota: 'Kontingent (wird aufgefüllt, Rest verfällt)',
  check: 'Haken (abhaken)',
  action: 'Knöpfe (verändern andere Zähler)',
};

export const PERIOD_LABEL: Record<Period, string> = { daily: 'täglich', weekly: 'wöchentlich' };
export const SECTION_LABEL: Record<Section, string> = { daily: 'Täglich', weekly: 'Wöchentlich' };
export const SCOPE_LABEL: Record<Scope, string> = { character: 'pro Charakter', account: 'server-weit (Account)' };
