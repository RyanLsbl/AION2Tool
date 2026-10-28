// Kleine UI-Bausteine: Modal, Toasts, Uhr, Klassen-Abzeichen.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { classByKey } from '../shared/classes';
import type { Character } from '../shared/types';

// ---- Uhr ----

/** Aktuelle Zeit, die sich alle `ms` aktualisiert (für Countdowns und Hochrechnung). */
export function useNow(ms = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    const onVis = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
  return now;
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

// ---- Toasts ----

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.kind === 'error' ? 7000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn btn-small btn-ghost"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Fehler als Toast anzeigen */
export function useErrorToast(): (e: unknown) => void {
  const toast = useToast();
  return useCallback((e: unknown) => toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) }), [toast]);
}

// ---- Modal ----

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---- Charakter ----

export function ClassIcon({ classKey, small }: { classKey: string | null; small?: boolean }) {
  const c = classByKey(classKey);
  return (
    <span
      className={`class-icon ${small ? 'class-icon-small' : ''}`}
      style={{ '--class-color': c?.color ?? 'var(--surface-3)' } as CSSProperties}
      title={c?.name ?? 'Klasse unbekannt'}
      aria-label={c?.name ?? 'Klasse unbekannt'}
      role="img"
    >
      {c?.emoji ?? '❔'}
    </span>
  );
}

export function fmtInt(v: number | null | undefined): string {
  return v == null ? '–' : v.toLocaleString('de-DE');
}

export function CharStats({ c }: { c: Character }) {
  return (
    <span className="char-stats">
      {c.level != null && <span title="Stufe">Lv. {c.level}</span>}
      {c.itemLevel != null && <span title="Gegenstandsstufe">GS {fmtInt(c.itemLevel)}</span>}
      {c.combatPower != null && <span title="Kampfkraft">KK {fmtInt(c.combatPower)}</span>}
    </span>
  );
}

export function timeAgo(t: number | null, now = Date.now()): string {
  if (!t) return 'nie';
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

export function Spinner() {
  return <span className="spinner" aria-label="Lädt" />;
}
