// Charaktere: Main & Twinks, Werte von PlayNC.

import { useState } from 'react';
import { classByKey } from '../../shared/classes';
import type { Character, Me } from '../../shared/types';
import { del, post } from '../api';
import type { Session } from '../App';
import { ClassIcon, fmtInt, timeAgo, useErrorToast, useNow, useToast } from '../ui';
import { AddCharacterForm } from './Onboarding';

const MAX_CHARACTERS = 8;

export function Characters({ session }: { session: Session }) {
  const { me, info } = session;
  const now = useNow(60_000);
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();
  const onError = useErrorToast();

  const run = async (c: Character, fn: () => Promise<{ me: Me; error?: string }>, ok: string) => {
    setBusy(c.id);
    try {
      const r = await fn();
      session.setMe(r.me);
      toast(r.error ? { kind: 'error', text: r.error } : { kind: 'ok', text: ok });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="chars-page">
      <div className="page-head">
        <div>
          <h1>Charaktere</h1>
          <p className="muted">
            Dein Main muss in der Legion {info.legion} sein. Twinks dürfen in jeder Legion sein, müssen aber auf {info.server} spielen. Die Werte kommen alle paar Stunden
            automatisch von PlayNC.
          </p>
        </div>
      </div>

      <div className="char-grid">
        {me.characters.map((c) => {
          const cls = classByKey(c.classKey);
          const inLegion = (c.legion ?? '').trim().toLowerCase() === info.legion.trim().toLowerCase();
          return (
            <article key={c.id} className={`card char-card ${c.isMain ? 'is-main' : ''}`}>
              <header>
                <ClassIcon classKey={c.classKey} />
                <div>
                  <h2>
                    {c.name}
                    {c.isMain && <span className="badge badge-gold">Main</span>}
                  </h2>
                  <span className="muted">{cls?.name ?? c.className ?? 'Klasse unbekannt'}</span>
                </div>
              </header>
              <dl className="stat-list">
                <div>
                  <dt>Stufe</dt>
                  <dd>{c.level ?? '–'}</dd>
                </div>
                <div>
                  <dt>Gegenstandsstufe</dt>
                  <dd>{fmtInt(c.itemLevel)}</dd>
                </div>
                <div>
                  <dt>Kampfkraft</dt>
                  <dd>{fmtInt(c.combatPower)}</dd>
                </div>
                <div>
                  <dt>Legion</dt>
                  <dd className={inLegion ? 'ok-text' : ''}>
                    {c.legion ?? 'keine'}
                    {inLegion && ' ✓'}
                  </dd>
                </div>
              </dl>
              <p className="fine">
                PlayNC: {c.armoryError ? <span className="warn-text">⚠️ {c.armoryError}</span> : <>aktualisiert {timeAgo(c.armoryAt, now)}</>}
              </p>
              <footer className="row gap wrap">
                <button className="btn btn-small" disabled={busy === c.id} onClick={() => void run(c, () => post(`/api/characters/${c.id}/refresh`), `${c.name} aktualisiert.`)}>
                  🔄 Aktualisieren
                </button>
                {!c.isMain && (
                  <button
                    className="btn btn-small btn-ghost"
                    disabled={busy === c.id}
                    onClick={() => void run(c, () => post(`/api/characters/${c.id}/main`), `${c.name} ist jetzt dein Main.`)}
                    title={`Nur möglich, wenn ${c.name} laut PlayNC in ${info.legion} ist`}
                  >
                    ★ Zum Main machen
                  </button>
                )}
                {(!c.isMain || me.characters.length === 1) && (
                  <button
                    className="btn btn-small btn-ghost danger"
                    disabled={busy === c.id}
                    onClick={() => {
                      const warn = c.isMain ? ' Ohne Main hast du keinen Zugang mehr, bis du einen neuen einträgst.' : '';
                      if (confirm(`${c.name} entfernen? Die Checklisten-Stände dieses Charakters werden gelöscht.${warn}`)) {
                        void run(c, () => del(`/api/characters/${c.id}`), `${c.name} entfernt.`);
                      }
                    }}
                  >
                    Entfernen
                  </button>
                )}
              </footer>
            </article>
          );
        })}

        {me.characters.length < MAX_CHARACTERS && (
          <article className="card char-card add-card">
            <h2>Twink hinzufügen</h2>
            <p className="muted">
              Noch {MAX_CHARACTERS - me.characters.length} von {MAX_CHARACTERS} Plätzen frei.
            </p>
            <AddCharacterForm session={session} asMain={false} label="Hinzufügen" />
          </article>
        )}
      </div>
    </div>
  );
}
