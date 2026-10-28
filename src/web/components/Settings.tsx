// Einstellungen: Abo, Warnungen, Darstellung, Reset-Zeiten, Account.

import { useState } from 'react';
import { formatWhen, nextReset, WEEKDAY_NAMES } from '../../shared/reset';
import { DEFAULT_PREFS, type Me, type Prefs } from '../../shared/types';
import { del, put } from '../api';
import type { Session } from '../App';
import { useErrorToast, useNow, useToast } from '../ui';

type Theme = 'dark' | 'light' | 'system';

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'system' ? t : 'dark';
  } catch {
    return 'dark';
  }
}

/** Dunkel ist Standard (ohne Attribut); hell und „wie das System“ werden am <html> markiert. */
export function applyTheme(t: Theme): void {
  if (t === 'dark') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === 'dark') localStorage.removeItem('theme');
    else localStorage.setItem('theme', t);
  } catch {
    // Speicher nicht verfügbar – gilt nur bis zum Neuladen
  }
}

/** Wechselt zwischen hell und dunkel (ausgehend von dem, was gerade zu sehen ist). */
export function toggleTheme(): void {
  const t = document.documentElement.dataset.theme;
  const light = t === 'light' || (t === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  applyTheme(light ? 'dark' : 'light');
}

export function Settings({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { me, info } = session;
  const now = useNow(60_000);
  const [prefs, setPrefs] = useState<Prefs>(me.prefs);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const toast = useToast();
  const onError = useErrorToast();

  const save = async (body: { abo?: boolean; prefs?: Prefs }, ok: string) => {
    setBusy(true);
    try {
      const r = await put<{ me: Me }>('/api/me/settings', body);
      session.setMe(r.me);
      setPrefs(r.me.prefs);
      toast({ kind: 'ok', text: ok });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    try {
      await del('/api/me');
      location.hash = '';
      location.reload();
    } catch (e) {
      onError(e);
    }
  };

  const daily = nextReset(now, 'daily', info.reset);
  const prefField = (key: keyof Prefs, label: string, hint: string) => (
    <label className="field">
      <span>{label}</span>
      <div className="row gap center-y">
        <input
          type="number"
          min={0}
          max={168}
          value={prefs[key]}
          onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.value === '' ? 0 : Number(e.target.value) }))}
          className="num-input"
        />
        <span className="muted">Stunden vorher</span>
      </div>
      <small className="muted">{hint}</small>
    </label>
  );

  return (
    <div className="settings-page">
      <div className="page-head">
        <div>
          <h1>Einstellungen</h1>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card">
          <h2>Abo</h2>
          <label className={`switch-label ${me.abo ? 'on' : ''}`}>
            <input type="checkbox" checked={me.abo} disabled={busy} onChange={() => void save({ abo: !me.abo }, me.abo ? 'Abo ausgeschaltet.' : 'Abo eingeschaltet.')} />
            <span className="switch" aria-hidden />
            <span>Spezielle Quai-Mitgliedschaft {me.abo ? 'aktiv' : 'aus'}</span>
          </label>
          <p className="muted small">
            Mit Abo gelten die höheren Maxima (z. B. Odyl-Energie 840 statt 560, Shugo-Schlüssel 21 statt 12) und der Knopf „Doppelt“ beim Kubus erscheint. Läuft dein Abo aus,
            schalte es hier wieder aus.
          </p>
        </section>

        <section className="card">
          <h2>Warnungen</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ prefs }, 'Warnungen gespeichert.');
            }}
          >
            {prefField('warnRegenHours', 'Regeneration (z. B. Odyl) bald voll', 'Warnung, wenn die natürliche Energie innerhalb dieser Zeit ihr Maximum erreicht.')}
            {prefField('warnWeeklyHours', 'Wochen-Kontingente verfallen', 'Warnung vor dem Weekly-Reset, wenn noch etwas übrig ist. 0 = aus.')}
            {prefField('warnDailyHours', 'Tages-Kontingente verfallen', 'Warnung vor dem Daily-Reset, wenn z. B. Aufträge offen sind. 0 = aus.')}
            <p className="muted small">Überlauf-Warnungen (z. B. Albtraum-Tickets verfallen morgen) erscheinen immer – außer du schaltest sie im Setup pro Eintrag stumm.</p>
            <div className="row gap">
              <button className="btn btn-primary" disabled={busy}>
                Speichern
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPrefs(DEFAULT_PREFS)}>
                Standard
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <h2>Darstellung</h2>
          <div className="segmented" role="radiogroup" aria-label="Farbschema">
            {(['dark', 'light', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                className={theme === t ? 'active' : ''}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                {t === 'system' ? 'Wie das System' : t === 'dark' ? 'Dunkel (Standard)' : 'Hell'}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Hilfe & Einrichtung</h2>
          <p className="muted small">Der Assistent fragt deine aktuellen Stände Schritt für Schritt ab, der Rundgang erklärt die Checkliste.</p>
          <div className="row gap wrap">
            <button className="btn" onClick={session.startWizard}>
              🪄 Einrichtungs-Assistent
            </button>
            <button className="btn" onClick={session.startTour}>
              🧭 Rundgang starten
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Reset-Zeiten</h2>
          <p>
            Daily-Reset täglich um <strong>{info.reset.time}</strong> ({info.reset.tz}) – bei dir <strong>{formatWhen(daily, now).replace(/^(heute|morgen) /, '')}</strong> Uhr.
          </p>
          <p>
            Weekly-Reset jeden <strong>{WEEKDAY_NAMES[info.reset.weeklyDay]}</strong> zur selben Zeit.
          </p>
          <p className="muted small">Die Zeiten legt die Legionsleitung fest. Stimmen sie nicht, sag einem Offizier Bescheid.</p>
        </section>

        <section className="card">
          <h2>Account</h2>
          <p>
            Angemeldet über Steam als <strong>{me.name}</strong>
            <br />
            <small className="muted">Steam-ID {me.steamId}</small>
          </p>
          <button className="btn" onClick={onLogout}>
            Abmelden
          </button>
          <details className="danger-zone">
            <summary>Account löschen</summary>
            <p className="small">
              Löscht deine Charaktere, deine Checkliste, eigene Einträge und alle Stände. Veröffentlichte Vorlagen bleiben erhalten. Das kann nicht rückgängig gemacht werden.
            </p>
            <label className="field">
              <span>Zum Bestätigen „LÖSCHEN“ eintippen</span>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </label>
            <button className="btn btn-danger" disabled={confirmText !== 'LÖSCHEN'} onClick={() => void deleteAccount()}>
              Account endgültig löschen
            </button>
          </details>
        </section>
      </div>
    </div>
  );
}
