// Einrichtungs-Assistent: führt neue Mitglieder Schritt für Schritt durch Abo, Charaktere,
// die aktuellen Stände aus dem Spiel und die Warnungen. Jeder Stand-Schritt speichert sofort.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compute, fmtNum, hasBonus, levelOk, maxOf, periodOf, type Computed, type Ctx } from '../../shared/engine';
import type { BoardItem, Character, Me, Prefs, TaskDef, TaskState } from '../../shared/types';
import { get, post, put } from '../api';
import type { Session } from '../App';
import { stateKey, type BoardResponse } from '../boardData';
import { CharStats, ClassIcon, Spinner, useErrorToast, useNow } from '../ui';
import { ruleText } from './Board';
import { AddCharacterForm } from './Onboarding';

type Page = { kind: 'welcome' } | { kind: 'abo' } | { kind: 'chars' } | { kind: 'stand'; item: BoardItem } | { kind: 'warn' } | { kind: 'done' };

interface Draft {
  value: string;
  bonus: string;
}

interface Target {
  charId: number;
  char: Character | null;
  locked: boolean;
}

// Komma als Dezimaltrenner und typografisches Minus erlauben
const parseNum = (s: string) => Number(s.trim().replace(',', '.').replace(/^−/, '-'));

/** Erklärt in einem Satz, wie ein Eintrag funktioniert und was eingetragen werden soll. */
function howItWorks(t: TaskDef, abo: boolean): string {
  const p = t.params;
  const max = fmtNum(maxOf(t, abo) ?? 0);
  const reset = periodOf(t) === 'daily' ? 'Daily-Reset' : 'Weekly-Reset (Mittwoch)';
  const when = periodOf(t) === 'daily' ? 'heute' : 'diese Woche';
  switch (t.kind) {
    case 'regen':
      return (
        `Trag ein, wie viel du gerade hast. Danach zählt das Tool alle ${fmtNum(p.intervalHours ?? 0)} Std. +${fmtNum(p.amount ?? 0)} dazu – bis höchstens ${max}.` +
        (hasBonus(t) ? ' Energie aus Items, die über das Maximum hinausgeht, gehört zu „Extra“ – sie wird erst verbraucht, wenn die natürliche aufgebraucht ist.' : '')
      );
    case 'stack':
      return (
        `Trag ein, wie viele du gerade hast. Bei jedem ${reset} kommen ${fmtNum(p.amount ?? 0)} dazu, gespeichert werden höchstens ${max}.` +
        (hasBonus(t) ? ` Zusätzliche aus Items (z. B. Herausforderungs-Tickets) gehören zu „Extra“ (bis ${fmtNum(p.bonusCap ?? 0)}).` : '')
      );
    case 'quota':
      return `Wie viele hast du ${when} noch übrig? Noch nichts davon gemacht → einfach ${max} stehen lassen. Beim ${reset} füllt das Tool wieder auf ${max} auf.`;
    case 'check':
      return `Schon ${when} erledigt? Beim ${reset} wird der Haken automatisch wieder geöffnet.`;
    case 'action':
      return '';
  }
}

function initialDraft(t: TaskDef, c: Computed): Draft {
  if (t.kind === 'check') return { value: (c.value ?? 1) <= 0 ? '0' : '1', bonus: '' };
  return { value: c.value == null ? '' : String(c.value), bonus: c.bonus > 0 ? String(c.bonus) : '' };
}

export function SetupWizard({ session, onFinish }: { session: Session; onFinish: (startTour: boolean) => void }) {
  const { me, info } = session;
  const now = useNow(60_000);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [states, setStates] = useState<Map<string, TaskState>>(new Map());
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [prefs, setPrefs] = useState<Prefs>(me.prefs);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const onError = useErrorToast();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadBoard = useCallback(async () => {
    const d = await get<BoardResponse>('/api/board');
    setBoard(d);
    setStates(new Map(d.states.map((s) => [stateKey(s.taskId, s.charId), s])));
  }, []);

  useEffect(() => {
    loadBoard().catch(onError);
  }, [loadBoard, onError]);

  const tasksById = useMemo(() => new Map((board?.tasks ?? []).map((t) => [t.id, t])), [board]);

  // Alle sichtbaren Einträge mit Stand (ohne Knöpfe): erst Täglich, dann Wöchentlich – wie in der Checkliste
  const pages: Page[] = useMemo(() => {
    const items = (board?.items ?? []).filter((i) => !i.hidden && tasksById.has(i.taskId) && tasksById.get(i.taskId)!.kind !== 'action');
    const order = { daily: 0, weekly: 1 };
    items.sort((a, b) => order[tasksById.get(a.taskId)!.section] - order[tasksById.get(b.taskId)!.section] || a.sort - b.sort);
    return [
      { kind: 'welcome' },
      { kind: 'abo' },
      { kind: 'chars' },
      ...items.map((item) => ({ kind: 'stand' as const, item })),
      { kind: 'warn' },
      { kind: 'done' },
    ];
  }, [board, tasksById]);

  const standPages = pages.filter((p) => p.kind === 'stand').length;
  const page = pages[Math.min(index, pages.length - 1)];
  const ctx: Ctx = { now, abo: me.abo, reset: info.reset };

  // Fokus auf die Überschrift jedes Schritts (Tastatur & Screenreader)
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [index]);

  const targetsFor = (t: TaskDef, item: BoardItem): Target[] =>
    t.scope === 'account'
      ? [{ charId: 0, char: null, locked: false }]
      : me.characters.filter((c) => !item.offChars.includes(c.id)).map((c) => ({ charId: c.id, char: c, locked: !levelOk(t, c.level) }));

  const draftFor = (t: TaskDef, charId: number): Draft => {
    const key = stateKey(t.id, charId);
    return drafts[key] ?? initialDraft(t, compute(t, states.get(key), ctx));
  };

  const setDraft = (t: TaskDef, charId: number, patch: Partial<Draft>) => {
    const key = stateKey(t.id, charId);
    setDrafts((d) => ({ ...d, [key]: { ...draftFor(t, charId), ...patch } }));
    setErrors((e) => {
      const n = { ...e };
      delete n[key];
      return n;
    });
  };

  /** Speichert die Eingaben eines Stand-Schritts. false = Eingabefehler. */
  const saveStand = async (t: TaskDef, targets: Target[]): Promise<boolean> => {
    const entries: { taskId: number; charId: number; value: number; bonus?: number }[] = [];
    const errs: Record<string, string> = {};
    for (const target of targets) {
      if (target.locked) continue;
      const key = stateKey(t.id, target.charId);
      const d = draftFor(t, target.charId);
      if (d.value.trim() === '') continue; // leer = später eintragen
      const value = parseNum(d.value);
      const bonus = d.bonus.trim() === '' ? 0 : parseNum(d.bonus);
      if (!Number.isFinite(value) || value < 0) {
        errs[key] = 'Bitte eine Zahl ab 0 eingeben.';
        continue;
      }
      if (hasBonus(t) && (!Number.isFinite(bonus) || bonus < 0)) {
        errs[key] = 'Extra: bitte eine Zahl ab 0 eingeben.';
        continue;
      }
      const c = compute(t, states.get(key), ctx);
      const changed = c.value == null || value !== c.value || (hasBonus(t) && bonus !== c.bonus);
      if (changed) entries.push({ taskId: t.id, charId: target.charId, value, ...(hasBonus(t) ? { bonus } : {}) });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return false;
    if (entries.length) {
      const r = await post<{ changes: { after: TaskState }[] }>('/api/state/bulk', { entries });
      setStates((prev) => {
        const n = new Map(prev);
        for (const ch of r.changes) n.set(stateKey(ch.after.taskId, ch.after.charId), ch.after);
        return n;
      });
      setSaved((s) => s + entries.length);
    }
    return true;
  };

  const go = (i: number) => {
    setErrors({});
    setIndex(Math.max(0, Math.min(i, pages.length - 1)));
  };

  const next = async () => {
    setBusy(true);
    try {
      if (page.kind === 'stand') {
        const t = tasksById.get(page.item.taskId)!;
        if (!(await saveStand(t, targetsFor(t, page.item)))) return;
      }
      if (page.kind === 'warn') {
        const r = await put<{ me: Me }>('/api/me/settings', { prefs });
        session.setMe(r.me);
      }
      go(index + 1);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const chooseAbo = async (abo: boolean) => {
    setBusy(true);
    try {
      const r = await put<{ me: Me }>('/api/me/settings', { abo });
      session.setMe(r.me);
      go(index + 1);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (startTour: boolean) => {
    setBusy(true);
    try {
      const r = await put<{ me: Me }>('/api/me/settings', { tutorialDone: true });
      session.setMe(r.me);
      onFinish(startTour);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  const quit = () => {
    if (confirm('Einrichtung beenden? Bereits eingetragene Stände bleiben gespeichert. Du kannst den Assistenten jederzeit über das „?“ oben rechts erneut starten.')) {
      void finish(false);
    }
  };

  if (!board) {
    return (
      <main className="wizard-page">
        <div className="center-block">
          <Spinner />
        </div>
      </main>
    );
  }

  const label =
    page.kind === 'stand'
      ? `Aktuelle Stände · ${pages.filter((p) => p.kind === 'stand').indexOf(page) + 1} von ${standPages}`
      : { welcome: 'Willkommen', abo: 'Abo', chars: 'Charaktere', warn: 'Warnungen', done: 'Fertig' }[page.kind];

  return (
    <main className="wizard-page">
      <div className="wizard card">
        <header className="wizard-head">
          <div className="wizard-progress" role="progressbar" aria-label="Fortschritt der Einrichtung" aria-valuemin={1} aria-valuemax={pages.length} aria-valuenow={index + 1}>
            <span style={{ width: `${(index / (pages.length - 1)) * 100}%` }} />
          </div>
          <div className="row between gap">
            <small className="wizard-step">
              {label} <span className="muted">· Schritt {index + 1} von {pages.length}</span>
            </small>
            {page.kind !== 'done' && (
              <button className="btn btn-ghost btn-small" onClick={quit} disabled={busy}>
                Einrichtung beenden
              </button>
            )}
          </div>
        </header>

        {page.kind === 'welcome' && (
          <section className="wizard-body">
            <h1 ref={headingRef} tabIndex={-1}>
              Willkommen, {me.name}! 👋
            </h1>
            <p className="lead">
              Schön, dass du da bist. In ein paar Minuten ist deine Checkliste eingerichtet: Wir fragen kurz ab, was du im Spiel gerade hast – danach rechnet das Tool
              alles selbst weiter.
            </p>
            <div className="feature-grid">
              <div className="feature">
                <span aria-hidden>⚡</span>
                <strong>Rechnet mit</strong>
                <small>Odyl-Energie, Albtraum-Tickets, Shugo-Schlüssel & Kontingente füllen sich nach den Spielregeln von selbst auf.</small>
              </div>
              <div className="feature">
                <span aria-hidden>🔔</span>
                <strong>Warnt rechtzeitig</strong>
                <small>Bevor Tickets überlaufen, die Energie voll ist oder Wochen-Kontingente verfallen.</small>
              </div>
              <div className="feature">
                <span aria-hidden>🧩</span>
                <strong>Dein Setup</strong>
                <small>Für Main und Twinks, mit eigenen Einträgen und Vorlagen der Legion.</small>
              </div>
            </div>
            <p className="tip">💡 Am besten hast du AION2 nebenbei offen, um die Werte direkt abzulesen. Was du nicht weißt, lässt du einfach leer.</p>
          </section>
        )}

        {page.kind === 'abo' && (
          <section className="wizard-body">
            <h1 ref={headingRef} tabIndex={-1}>
              Hast du ein Abo?
            </h1>
            <p className="lead">Gemeint ist die Spezielle Quai-Mitgliedschaft. Mit Abo gelten höhere Maxima.</p>
            <div className="choice-grid">
              <button className={`choice ${me.abo ? 'active' : ''}`} onClick={() => void chooseAbo(true)} disabled={busy}>
                <span className="choice-icon" aria-hidden>
                  💎
                </span>
                <strong>Ja, Abo ist aktiv</strong>
                <small>Odyl-Energie bis 840 statt 560 · Shugo-Schlüssel bis 21 statt 12 · Kubus doppelt öffnen (−80 Odyl)</small>
              </button>
              <button className={`choice ${!me.abo ? 'active' : ''}`} onClick={() => void chooseAbo(false)} disabled={busy}>
                <span className="choice-icon" aria-hidden>
                  🙂
                </span>
                <strong>Nein, kein Abo</strong>
                <small>Normale Maxima. Ändert sich das, schaltest du es oben in der Checkliste um.</small>
              </button>
            </div>
          </section>
        )}

        {page.kind === 'chars' && (
          <section className="wizard-body">
            <h1 ref={headingRef} tabIndex={-1}>
              Deine Charaktere
            </h1>
            <p className="lead">Jeder Charakter bekommt in der Checkliste eine eigene Spalte. Hast du Twinks auf {info.server}? Dann trag sie gleich hier ein.</p>
            <ul className="wizard-chars">
              {me.characters.map((c) => (
                <li key={c.id}>
                  <ClassIcon classKey={c.classKey} />
                  <div>
                    <strong>
                      {c.name}
                      {c.isMain && <span className="badge badge-gold">Main</span>}
                    </strong>
                    <CharStats c={c} />
                  </div>
                </li>
              ))}
            </ul>
            {me.characters.length < 8 && (
              <div className="wizard-add">
                <AddCharacterForm session={session} asMain={false} label="Twink hinzufügen" />
              </div>
            )}
            <p className="muted small">Twinks dürfen in jeder Legion sein. Du kannst sie auch später unter „Charaktere“ hinzufügen oder entfernen.</p>
          </section>
        )}

        {page.kind === 'stand' &&
          (() => {
            const t = tasksById.get(page.item.taskId)!;
            const targets = targetsFor(t, page.item);
            const max = maxOf(t, me.abo);
            const bonusPool = hasBonus(t);
            const first = pages.findIndex((p) => p.kind === 'stand') === index;
            return (
              <section className="wizard-body">
                <div className="stand-title">
                  <span className="row-icon" aria-hidden>
                    {t.icon}
                  </span>
                  <div>
                    <h1 ref={headingRef} tabIndex={-1}>
                      {t.name}
                    </h1>
                    <small className="muted">
                      {ruleText(t, me.abo)}
                      {t.scope === 'account' && ' · gilt für alle Charaktere zusammen'}
                    </small>
                  </div>
                </div>
                {t.note && <p className="stand-note">{t.note}</p>}
                <p className="instruction">
                  <span aria-hidden>✍️</span> {howItWorks(t, me.abo)}
                </p>
                {first && <p className="tip">💡 Im Spiel zeigt der Tooltip eines Zählers den aktuellen Stand und wann wieder aufgefüllt wird. Unbekannt? Feld leer lassen.</p>}

                <ul className="stand-rows">
                  {targets.map((target) => {
                    const key = stateKey(t.id, target.charId);
                    const d = draftFor(t, target.charId);
                    return (
                      <li key={key} className={`stand-row ${target.locked ? 'is-locked' : ''}`}>
                        <div className="stand-who">
                          {target.char ? <ClassIcon classKey={target.char.classKey} small /> : <span className="class-icon class-icon-small account-icon">🏠</span>}
                          <strong>{target.char ? target.char.name : 'Account'}</strong>
                          {target.char?.isMain && <span className="main-star">★</span>}
                        </div>
                        {target.locked ? (
                          <span className="muted small">
                            erst ab Stufe {t.params.minLevel} (Stufe {target.char?.level ?? '?'})
                          </span>
                        ) : t.kind === 'check' ? (
                          <div className="segmented" role="radiogroup" aria-label={`${t.name} – ${target.char?.name ?? 'Account'}`}>
                            <button role="radio" aria-checked={d.value !== '0'} className={d.value !== '0' ? 'active' : ''} onClick={() => setDraft(t, target.charId, { value: '1' })}>
                              noch offen
                            </button>
                            <button role="radio" aria-checked={d.value === '0'} className={d.value === '0' ? 'active' : ''} onClick={() => setDraft(t, target.charId, { value: '0' })}>
                              ✓ erledigt
                            </button>
                          </div>
                        ) : (
                          <div className="stand-inputs">
                            <label className="stand-field">
                              <span>{t.kind === 'quota' ? 'noch übrig' : bonusPool ? 'natürlich' : 'Stand'}</span>
                              <input
                                inputMode="decimal"
                                value={d.value}
                                onChange={(e) => setDraft(t, target.charId, { value: e.target.value })}
                                placeholder={t.kind === 'quota' ? String(max) : 'leer = später'}
                                aria-label={`${t.name} – ${target.char?.name ?? 'Account'}`}
                                aria-invalid={!!errors[key]}
                              />
                              {t.params.unit && <em>{t.params.unit}</em>}
                            </label>
                            {bonusPool && (
                              <label className="stand-field">
                                <span>Extra</span>
                                <input
                                  inputMode="decimal"
                                  value={d.bonus}
                                  onChange={(e) => setDraft(t, target.charId, { bonus: e.target.value })}
                                  placeholder="0"
                                  aria-label={`${t.name} – ${target.char?.name ?? 'Account'} – Extra-Vorrat`}
                                />
                              </label>
                            )}
                            <div className="quick">
                              <button type="button" className="chip" onClick={() => setDraft(t, target.charId, { value: '0' })}>
                                0
                              </button>
                              {max != null && (
                                <button type="button" className="chip" onClick={() => setDraft(t, target.charId, { value: String(max) })}>
                                  {t.kind === 'quota' ? `alles (${fmtNum(max)})` : `voll (${fmtNum(max)})`}
                                </button>
                              )}
                            </div>
                            {errors[key] && <span className="field-error">{errors[key]}</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })()}

        {page.kind === 'warn' && (
          <section className="wizard-body">
            <h1 ref={headingRef} tabIndex={-1}>
              Wann sollen wir dich warnen?
            </h1>
            <p className="lead">Warnungen erscheinen als Banner oben in der Checkliste – so zum Beispiel:</p>
            <div className="banner banner-warn demo-banner" aria-hidden>
              <span className="banner-icon">🌙</span>
              <span className="banner-text">
                <strong>
                  Albtraum <span className="banner-who">· {me.characters.find((c) => c.isMain)?.name ?? 'Main'}</span>
                </strong>
                13/14 – beim nächsten Reset verfallen 1
              </span>
            </div>
            <p className="muted small">Überlauf-Warnungen wie diese kommen immer, wenn etwas verfallen würde. Mit ✕ blendest du einen Hinweis bis zum nächsten Reset aus.</p>
            <div className="warn-grid">
              <WarnField label="⚡ Energie bald voll" hint="Warnung, wenn z. B. die Odyl-Energie innerhalb dieser Zeit voll ist." value={prefs.warnRegenHours} onChange={(v) => setPrefs((p) => ({ ...p, warnRegenHours: v }))} />
              <WarnField label="📅 Wochen-Kontingente" hint="Erinnerung vor dem Weekly-Reset, wenn noch etwas übrig ist. 0 = aus." value={prefs.warnWeeklyHours} onChange={(v) => setPrefs((p) => ({ ...p, warnWeeklyHours: v }))} />
              <WarnField label="📜 Tages-Kontingente" hint="Erinnerung vor dem Daily-Reset, z. B. an offene Aufträge. 0 = aus." value={prefs.warnDailyHours} onChange={(v) => setPrefs((p) => ({ ...p, warnDailyHours: v }))} />
            </div>
          </section>
        )}

        {page.kind === 'done' && (
          <section className="wizard-body">
            <h1 ref={headingRef} tabIndex={-1}>
              Alles eingerichtet! 🎉
            </h1>
            <p className="lead">
              {saved > 0 ? `Du hast ${saved} ${saved === 1 ? 'Stand' : 'Stände'} eingetragen.` : 'Deine Checkliste ist bereit.'} Ab jetzt rechnet das Tool selbst weiter – hier die
              wichtigsten Handgriffe:
            </p>
            <ul className="tips-list">
              <li>
                <span className="kbd">−</span> wenn du etwas benutzt (z. B. ein Albtraum-Ticket), <span className="kbd">+</span> für Extras aus Items.
              </li>
              <li>Ein Klick auf eine Zahl öffnet den Editor – dort übernimmst du jederzeit den Stand aus dem Spiel.</li>
              <li>Verklickt? In der Meldung unten auf „Rückgängig“.</li>
              <li>Unter „Mein Setup“ baust du die Checkliste um und legst eigene Einträge an (z. B. Heiligtum).</li>
              <li>
                Das <span className="kbd">?</span> oben rechts startet diesen Assistenten oder den Rundgang erneut.
              </li>
            </ul>
          </section>
        )}

        <footer className="wizard-foot">
          {page.kind === 'welcome' && (
            <>
              <button className="btn btn-ghost" onClick={quit} disabled={busy}>
                Überspringen
              </button>
              <button className="btn btn-primary" onClick={() => go(1)}>
                Los geht's →
              </button>
            </>
          )}
          {page.kind === 'abo' && (
            <button className="btn btn-ghost" onClick={() => go(index - 1)} disabled={busy}>
              ← Zurück
            </button>
          )}
          {(page.kind === 'chars' || page.kind === 'stand' || page.kind === 'warn') && (
            <>
              <button className="btn btn-ghost" onClick={() => go(index - 1)} disabled={busy}>
                ← Zurück
              </button>
              <span className="spacer" />
              {page.kind === 'stand' && (
                <button className="btn btn-ghost" onClick={() => go(index + 1)} disabled={busy} title="Nichts speichern und weiter">
                  Überspringen
                </button>
              )}
              <button className="btn btn-primary" onClick={() => void next()} disabled={busy}>
                {busy ? 'Speichere …' : page.kind === 'stand' ? 'Speichern & weiter →' : 'Weiter →'}
              </button>
            </>
          )}
          {page.kind === 'done' && (
            <>
              <button className="btn btn-ghost" onClick={() => void finish(false)} disabled={busy}>
                Direkt zur Checkliste
              </button>
              <button className="btn btn-primary" onClick={() => void finish(true)} disabled={busy}>
                🧭 Rundgang starten
              </button>
            </>
          )}
        </footer>
      </div>
    </main>
  );
}

function WarnField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field warn-field">
      <span>{label}</span>
      <div className="row gap center-y">
        <input type="number" min={0} max={168} value={value} onChange={(e) => onChange(Math.max(0, Math.min(168, Number(e.target.value) || 0)))} className="num-input" />
        <span className="muted">Std. vorher</span>
      </div>
      <small className="muted">{hint}</small>
    </label>
  );
}
