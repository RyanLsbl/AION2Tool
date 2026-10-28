// Rundgang: hebt nacheinander Bereiche der echten Oberfläche hervor und erklärt sie.
// Ziele sind Elemente mit data-tour="…"; fehlt ein Ziel (z. B. gerade keine Warnung), wird der Schritt übersprungen.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export interface TourStep {
  target: string;
  title: string;
  text: string;
}

export const BOARD_TOUR: TourStep[] = [
  {
    target: 'reset',
    title: 'Resets im Blick',
    text: 'Hier siehst du, wann der nächste Daily- und Weekly-Reset ist. Danach füllt das Tool Tickets und Kontingente automatisch auf – zurücksetzen musst du nichts.',
  },
  {
    target: 'abo',
    title: 'Abo-Schalter',
    text: 'Hast du die Spezielle Quai-Mitgliedschaft? Dann hier einschalten: Es gelten die höheren Maxima und beim Kubus erscheint der Knopf „Doppelt“.',
  },
  {
    target: 'banners',
    title: 'Warnungen',
    text: 'Würden morgen Tickets verfallen, ist die Energie bald voll oder ist vor dem Reset noch etwas offen, steht das hier. Mit ✕ blendest du einen Hinweis bis zum nächsten Reset aus.',
  },
  {
    target: 'col-head',
    title: 'Deine Charaktere',
    text: 'Jede Spalte ist ein Charakter – mit Stufe, Gegenstandsstufe (GS) und Kampfkraft (KK) von PlayNC. Die Spalte „Account“ gilt für alle zusammen, z. B. Shugo-Schlüssel und Aufträge. Auf dem Handy wechselst du den Charakter über die Leiste darüber.',
  },
  {
    target: 'counter',
    title: 'Zähler bedienen',
    text: '„−“ drückst du, wenn du etwas benutzt (z. B. ein Albtraum-Ticket), „+“ für Extras aus Items. Ein Klick auf die Zahl öffnet den Editor, um den Stand aus dem Spiel zu übernehmen. Darunter steht, wann Nachschub kommt. Verklickt? In der Meldung unten auf „Rückgängig“.',
  },
  {
    target: 'set-stand',
    title: 'Noch kein Stand?',
    text: 'Wo „Stand eintragen“ steht, kennt das Tool deinen Wert noch nicht. Einmal eintragen – danach rechnet es selbst weiter.',
  },
  {
    target: 'actions',
    title: 'Expedition & Transzendenz',
    text: '„Belohnung“ zieht 40 Odyl-Energie ab, „Ohne Belohnung“ einen deiner 10 Läufe der Woche. Reicht etwas nicht, ist der Knopf ausgegraut – ein Klick darauf sagt dir, warum.',
  },
  {
    target: 'info',
    title: 'Erklärungen',
    text: 'Das ⓘ neben einem Eintrag erklärt, wie er funktioniert und was du eintragen solltest.',
  },
  {
    target: 'nav-setup',
    title: 'Mein Setup',
    text: 'Hier baust du deine Checkliste um: Reihenfolge, Einträge ausblenden, pro Charakter an/aus, Warnungen stummschalten, eigene Einträge (z. B. Heiligtum) und Vorlagen anderer Mitglieder.',
  },
  {
    target: 'nav-chars',
    title: 'Charaktere',
    text: 'Twinks hinzufügen, deinen Main wechseln oder die Werte von PlayNC sofort aktualisieren.',
  },
  {
    target: 'help',
    title: 'Hilfe',
    text: 'Über das „?“ startest du diesen Rundgang oder den Einrichtungs-Assistenten jederzeit erneut. Viel Spaß beim Farmen! ⚔️',
  },
];

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;

/** Sichtbares Ziel finden (bei mehreren gleichen Zielen das erste sichtbare). */
function findTarget(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [available, setAvailable] = useState<TourStep[] | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);

  // Kurz warten, bis die Seite gerendert ist, dann nur die Schritte mit vorhandenem Ziel behalten
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      const found = steps.filter((s) => findTarget(s.target));
      if (found.length >= Math.min(3, steps.length) || tries > 30) {
        clearInterval(id);
        setAvailable(found.length ? found : steps.slice(-1));
      }
    }, 100);
    return () => clearInterval(id);
  }, [steps]);

  const step = available?.[index];

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step]);

  // Ziel in den sichtbaren Bereich holen und vermessen
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    measure();
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [step, measure]);

  // Mitlaufen bei Scrollen (auch im Raster) und Größenänderungen
  useEffect(() => {
    const on = () => measure();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [measure]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [step, box]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [index, available]);

  const last = !!available && index >= available.length - 1;
  const nextStep = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const prevStep = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') nextStep();
      else if (e.key === 'ArrowLeft') prevStep();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nextStep, prevStep, onClose]);

  if (!available || !step) return <div className="tour-shade" />;

  // Karte unter dem Ziel, sonst darüber; ohne Ziel mittig
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(380, vw - 24);
  let cardStyle: CSSProperties;
  if (box) {
    const below = box.top + box.height + 12;
    const top = below + cardH <= vh - 12 ? below : Math.max(12, box.top - cardH - 12);
    const left = Math.min(Math.max(12, box.left + box.width / 2 - cardW / 2), vw - cardW - 12);
    cardStyle = { top, left, width: cardW };
  } else {
    cardStyle = { top: Math.max(12, vh / 2 - cardH / 2), left: vw / 2 - cardW / 2, width: cardW };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Rundgang">
      {box ? <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} /> : <div className="tour-shade" />}
      <div className="tour-card" style={cardStyle} ref={cardRef} tabIndex={-1}>
        <div className="row between gap">
          <small className="tour-count">
            {index + 1} / {available.length}
          </small>
          <button className="icon-btn" onClick={onClose} aria-label="Rundgang beenden">
            ✕
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="row gap end">
          {index > 0 && (
            <button className="btn btn-ghost btn-small" onClick={prevStep}>
              ← Zurück
            </button>
          )}
          <button className="btn btn-primary btn-small" onClick={nextStep}>
            {last ? 'Fertig' : 'Weiter →'}
          </button>
        </div>
      </div>
    </div>
  );
}
