// Die 8 Klassen der Global-Version (Stand Oktober 2026), wie im Legions-Bot.

export interface ClassDef {
  key: string;
  name: string;
  emoji: string;
  color: string;
}

export const CLASSES: ClassDef[] = [
  { key: 'gladiator', name: 'Gladiator', emoji: '⚔️', color: '#c0392b' },
  { key: 'templar', name: 'Templer', emoji: '🛡️', color: '#2980b9' },
  { key: 'assassin', name: 'Assassine', emoji: '🗡️', color: '#8e44ad' },
  { key: 'ranger', name: 'Waldläufer', emoji: '🏹', color: '#27ae60' },
  { key: 'sorcerer', name: 'Magier', emoji: '🔥', color: '#e67e22' },
  { key: 'spiritmaster', name: 'Beschwörer', emoji: '🌀', color: '#16a085' },
  { key: 'cleric', name: 'Kleriker', emoji: '✨', color: '#f1c40f' },
  { key: 'chanter', name: 'Kantor', emoji: '🎶', color: '#d35400' },
];

export function classByKey(key: string | null | undefined): ClassDef | undefined {
  return CLASSES.find((c) => c.key === key);
}

const CLASS_NAME_PATTERNS: [RegExp, string][] = [
  [/gladiat/i, 'gladiator'],
  [/templ/i, 'templar'],
  [/assass/i, 'assassin'],
  [/ranger|waldl/i, 'ranger'],
  [/sorcer|magier|zauber/i, 'sorcerer'],
  [/spirit|element|beschw/i, 'spiritmaster'],
  [/cleric|kleriker/i, 'cleric'],
  [/chanter|kantor/i, 'chanter'],
];

/** Ordnet den Klassennamen aus PlayNC (englisch oder deutsch) einer Klasse zu. */
export function classKeyFromName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return CLASS_NAME_PATTERNS.find(([re]) => re.test(name))?.[1];
}
