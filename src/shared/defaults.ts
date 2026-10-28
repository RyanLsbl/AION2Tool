// Standard-Vorlage der Legion (Stand: Global, Oktober 2026 – mit der Legion abgestimmt).
// Wird beim ersten Start angelegt; danach pflegen Offiziere alles im Admin-Bereich.

import type { Kind, Scope, Section, TaskParams } from './types.js';

export interface SeedTask {
  key: string;
  name: string;
  icon: string;
  kind: Kind;
  scope: Scope;
  section: Section;
  /** Knöpfe verweisen über `key` auf andere Einträge (wird beim Anlegen in IDs umgesetzt) */
  params: Omit<TaskParams, 'actions'> & {
    actions?: { id: string; label: string; aboOnly?: boolean; effects: { key: string; delta: number }[] }[];
  };
  note: string;
}

export const DEFAULT_TASKS: SeedTask[] = [
  // ---- Täglich ----
  {
    key: 'odyl',
    name: 'Odyl-Energie',
    icon: '⚡',
    kind: 'regen',
    scope: 'character',
    section: 'daily',
    params: { amount: 15, intervalHours: 3, cap: 560, capAbo: 840, step: 40, bonusCap: 2000 },
    note: '+15 alle 3 Std. bis 560 (mit Abo 840). Energie aus Items kommt mit „+“ in den Extra-Vorrat (laut Client bis 2000) und wird erst nach der natürlichen verbraucht. Expedition/Transzendenz mit Belohnung ziehen automatisch 40 ab.',
  },
  {
    key: 'runs',
    name: 'Expedition / Transzendenz',
    icon: '🗺️',
    kind: 'action',
    scope: 'character',
    section: 'daily',
    params: {
      period: 'weekly',
      actions: [
        { id: 'reward', label: 'Belohnung (−40 Odyl)', effects: [{ key: 'odyl', delta: -40 }] },
        { id: 'double', label: 'Doppelt (−80 Odyl)', aboOnly: true, effects: [{ key: 'odyl', delta: -80 }] },
        { id: 'noreward', label: 'Ohne Belohnung', effects: [{ key: 'runquota', delta: -1 }] },
      ],
    },
    note: 'Erkundung, Eroberung und Transzendenz. Mit Belohnung: Kubus für 40 Odyl öffnen (Abo: zweites Öffnen für weitere 40). Ohne Belohnung: zählt gegen die 10 Läufe pro Woche.',
  },
  {
    key: 'nightmare',
    name: 'Albtraum',
    icon: '🌙',
    kind: 'stack',
    scope: 'character',
    section: 'daily',
    params: { period: 'daily', amount: 2, cap: 14, bonusCap: 30, minLevel: 45 },
    note: '+2 Versuche pro Tag, bis 14 gespeichert. Ein Versuch wird erst beim Boss-Kill verbraucht. Zusätzliche Versuche aus Herausforderungs-Tickets (z. B. Daeva-Pass) mit „+“ eintragen – sie landen im Extra-Vorrat (bis 30) und werden erst nach den täglichen verbraucht.',
  },
  {
    key: 'shugo',
    name: 'Shugo-Festival-Schlüssel',
    icon: '🔑',
    kind: 'stack',
    scope: 'account',
    section: 'daily',
    params: { period: 'daily', amount: 3, cap: 12, capAbo: 21 },
    note: '+3 pro Tag, bis 12 (mit Abo 21). Gilt für alle Charaktere auf dem Server zusammen.',
  },
  {
    key: 'duty',
    name: 'Aufträge',
    icon: '📜',
    kind: 'quota',
    scope: 'account',
    section: 'daily',
    params: { period: 'daily', amount: 5 },
    note: '5 Aufträge pro Tag, server-weit. Nicht erledigte verfallen beim Reset.',
  },
  // ---- Wöchentlich ----
  {
    key: 'runquota',
    name: 'Läufe ohne Belohnung',
    icon: '🎲',
    kind: 'quota',
    scope: 'account',
    section: 'weekly',
    params: { period: 'weekly', amount: 10, warn: false },
    note: 'Expedition (Erkundung/Eroberung) und Transzendenz zusammen: 10 Läufe ohne Belohnung pro Woche, server-weit. Läufe mit Belohnung (Odyl) zählen nicht.',
  },
  {
    key: 'dailydungeon',
    name: 'Tägliches Dungeon',
    icon: '🏰',
    kind: 'quota',
    scope: 'account',
    section: 'weekly',
    params: { period: 'weekly', amount: 14 },
    note: '14 Eintritte pro Woche, server-weit. Rest verfällt am Mittwoch.',
  },
  {
    key: 'ascension',
    name: 'Aufstiegsprüfung',
    icon: '🗼',
    kind: 'quota',
    scope: 'character',
    section: 'weekly',
    params: { period: 'weekly', amount: 3 },
    note: '3 Eintritte pro Woche und Charakter.',
  },
  {
    key: 'abyss',
    name: 'Abyss-Zeit (je Ebene)',
    icon: '🌌',
    kind: 'quota',
    scope: 'character',
    section: 'weekly',
    params: { period: 'weekly', amount: 7, unit: 'Std.', warn: false },
    note: '7 Stunden pro Ebene und Woche.',
  },
  {
    key: 'battlefield',
    name: 'Schlachtfeld-Siege',
    icon: '⚔️',
    kind: 'quota',
    scope: 'character',
    section: 'weekly',
    params: { period: 'weekly', amount: 3 },
    note: '3 Sieg-Belohnungen pro Woche und Charakter.',
  },
  {
    key: 'arena',
    name: 'Arena-Siege',
    icon: '🏟️',
    kind: 'quota',
    scope: 'character',
    section: 'weekly',
    params: { period: 'weekly', amount: 30, warn: false },
    note: 'Bis zu 30 belohnte Siege pro Woche.',
  },
  {
    key: 'cmd_pve',
    name: 'Befehls-Schriftrollen PvE',
    icon: '📘',
    kind: 'quota',
    scope: 'account',
    section: 'weekly',
    params: { period: 'weekly', amount: 12 },
    note: 'Beim Befehlshändler in der Hauptstadt, 12 pro Woche, server-weit.',
  },
  {
    key: 'cmd_pvp',
    name: 'Befehls-Schriftrollen PvP',
    icon: '📕',
    kind: 'quota',
    scope: 'account',
    section: 'weekly',
    params: { period: 'weekly', amount: 20 },
    note: 'Beim Abyss-Händler, 20 pro Woche, server-weit.',
  },
];

/** Auswahl an Symbolen für eigene Einträge. */
export const ICONS = [
  '⚡', '🌙', '🔑', '📜', '🗺️', '🎲', '🏰', '🗼', '🌌', '⚔️', '🏟️', '📘', '📕', '🐉', '👑', '💎',
  '🧪', '🛡️', '🗡️', '🏹', '🔥', '✨', '🎁', '🪙', '📦', '🎯', '⏳', '🌀', '🍀', '🎃', '🛠️', '✅',
];
