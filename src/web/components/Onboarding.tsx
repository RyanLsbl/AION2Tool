// Freischaltung: Main eintragen, auf Bestätigung warten, ausgetreten, gesperrt.

import { useState, type FormEvent } from 'react';
import type { Me } from '../../shared/types';
import { ApiError, post } from '../api';
import type { Session } from '../App';
import { CharStats, ClassIcon, timeAgo, useErrorToast, useToast } from '../ui';

export function Onboarding({ session }: { session: Session }) {
  const { me, info } = session;
  const main = me.characters.find((c) => c.isMain);
  const [showForm, setShowForm] = useState(me.access === 'needs-main');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const onError = useErrorToast();

  const recheck = async () => {
    if (!main) return;
    setBusy(true);
    try {
      const r = await post<{ me: Me; error?: string }>(`/api/characters/${main.id}/refresh`);
      session.setMe(r.me);
      if (r.error) toast({ kind: 'error', text: r.error });
      else if (r.me.access !== 'ok') toast({ kind: 'info', text: 'Noch nicht bestätigt – PlayNC zeigt dich (noch) nicht in der Legion.' });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  if (me.access === 'blocked') {
    return (
      <main className="center-page">
        <div className="card narrow">
          <h1>⛔ Zugang gesperrt</h1>
          <p>Dein Account wurde von einem Offizier gesperrt. Wende dich bitte an die Legionsleitung.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="center-page">
      <div className="card narrow onboarding">
        {me.access === 'needs-main' && (
          <>
            <h1>Willkommen, {me.name}!</h1>
            <p>
              Trag deinen <strong>Main</strong> ein. Er muss laut PlayNC in der Legion <strong>{info.legion}</strong> auf <strong>{info.server}</strong> sein – dann bist du sofort
              freigeschaltet. Twinks kannst du danach hinzufügen.
            </p>
          </>
        )}
        {(me.access === 'pending' || me.access === 'left') && main && (
          <>
            <h1>{me.access === 'pending' ? '⏳ Warte auf Bestätigung' : '🚪 Nicht mehr in der Legion'}</h1>
            <div className="char-line">
              <ClassIcon classKey={main.classKey} />
              <strong>{main.name}</strong>
              <CharStats c={main} />
            </div>
            <p>
              Laut PlayNC ist <strong>{main.name}</strong> {me.legionSeen ? <>in der Legion „{me.legionSeen}“</> : 'in keiner Legion'} (geprüft{' '}
              {timeAgo(me.legionCheckedAt)}).
            </p>
            {me.access === 'pending' ? (
              <p className="muted">
                Gerade erst beigetreten? PlayNC übernimmt Legionswechsel mit Verzögerung. Wir prüfen automatisch weiter (2 Std. lang alle 10 Min., danach stündlich) – du
                wirst freigeschaltet, sobald {main.name} in {info.legion} steht.
              </p>
            ) : (
              <p className="muted">Sobald du wieder in {info.legion} bist, wirst du automatisch freigeschaltet. Deine Checkliste bleibt erhalten.</p>
            )}
            <div className="row gap">
              <button className="btn" disabled={busy} onClick={recheck}>
                {busy ? 'Prüfe …' : 'Jetzt erneut prüfen'}
              </button>
              {!showForm && (
                <button className="btn btn-ghost" onClick={() => setShowForm(true)}>
                  Anderen Main eintragen
                </button>
              )}
            </div>
          </>
        )}
        {showForm && <AddCharacterForm session={session} asMain label="Main eintragen" />}
      </div>
    </main>
  );
}

/** Formular zum Eintragen eines Charakters – inkl. Anfrage an Offiziere, wenn er schon vergeben ist. */
export function AddCharacterForm({ session, asMain, label, onDone }: { session: Session; asMain: boolean; label: string; onDone?: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const toast = useToast();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setClaim(null);
    try {
      const r = await post<{ me: Me }>('/api/characters', { name: name.trim(), main: asMain });
      session.setMe(r.me);
      setName('');
      toast({ kind: 'ok', text: `${name.trim()} eingetragen.` });
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'claimed') setClaim(name.trim());
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendClaim = async () => {
    if (!claim) return;
    setBusy(true);
    try {
      await post('/api/claims', { name: claim, main: asMain, note });
      toast({ kind: 'ok', text: 'Anfrage an die Offiziere gesendet.' });
      setClaim(null);
      setError(null);
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-char" onSubmit={submit}>
      <label className="field">
        <span>Charaktername ({session.info.server})</span>
        <div className="row gap">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Lyra" maxLength={16} autoFocus={asMain} disabled={busy} />
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Suche bei PlayNC …' : label}
          </button>
        </div>
      </label>
      {error && <p className="alert alert-danger">{error}</p>}
      {claim && (
        <div className="alert alert-info">
          <p>
            Ist <strong>{claim}</strong> wirklich dein Charakter? Dann schick eine Anfrage an die Offiziere – sie können ihn dir übertragen.
          </p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kurze Nachricht (optional), z. B. Discord-Name" maxLength={300} rows={2} />
          <button type="button" className="btn" onClick={sendClaim} disabled={busy}>
            Anfrage senden
          </button>
        </div>
      )}
    </form>
  );
}
