// Formular für einen Eintrag (eigener Eintrag im Builder oder Standard-Eintrag im Admin-Bereich).

import { useState } from 'react';
import { ICONS } from '../../shared/defaults';
import { validateTask } from '../../shared/engine';
import {
  KIND_LABEL, PERIOD_LABEL, SCOPE_LABEL, SECTION_LABEL, type ActionDef, type Kind, type Period, type Scope, type Section, type TaskDef, type TaskParams,
} from '../../shared/types';

export interface TaskDraft {
  name: string;
  icon: string;
  kind: Kind;
  scope: Scope;
  section: Section;
  params: TaskParams;
  note: string;
  defaultOn?: boolean;
}

export function emptyDraft(): TaskDraft {
  return { name: '', icon: '✅', kind: 'quota', scope: 'character', section: 'daily', params: { period: 'daily', amount: 1 }, note: '' };
}

export function draftFrom(t: TaskDef): TaskDraft {
  return { name: t.name, icon: t.icon, kind: t.kind, scope: t.scope, section: t.section, params: structuredClone(t.params), note: t.note, defaultOn: t.defaultOn };
}

const KIND_HELP: Record<Kind, string> = {
  regen: 'Wächst alle X Stunden um eine Menge bis zum Maximum – wie die Odyl-Energie.',
  stack: 'Bekommt bei jedem Reset Nachschub und sammelt sich bis zum Maximum an – wie Albtraum-Tickets. Warnt, bevor etwas überläuft.',
  quota: 'Wird bei jedem Reset wieder aufgefüllt, Rest verfällt – wie „14 Eintritte pro Woche“.',
  check: 'Einfach abhaken; wird beim Reset wieder geöffnet.',
  action: 'Knöpfe, die andere Einträge verändern – z. B. „Lauf mit Belohnung: −40 Odyl“.',
};

function NumberField({
  label,
  value,
  onChange,
  optional,
  hint,
  step,
  placeholder,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  optional?: boolean;
  hint?: string;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {optional && <em> (optional)</em>}
      </span>
      <input
        type="number"
        min={0}
        step={step ?? 'any'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder={placeholder ?? (optional ? 'leer = wie ohne Abo' : '')}
      />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function TaskForm({
  initial,
  targets,
  onSubmit,
  onCancel,
  submitLabel,
  admin,
}: {
  initial: TaskDraft;
  /** mögliche Ziele für Knöpfe */
  targets: TaskDef[];
  onSubmit: (d: TaskDraft & { addToAll?: boolean }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  admin?: { isNew: boolean };
}) {
  const [d, setD] = useState<TaskDraft>(initial);
  const [addToAll, setAddToAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const p = d.params;
  const set = (patch: Partial<TaskDraft>) => setD((x) => ({ ...x, ...patch }));
  const setP = (patch: Partial<TaskParams>) => setD((x) => ({ ...x, params: { ...x.params, ...patch } }));

  const changeKind = (kind: Kind) => {
    const period: Period = d.section === 'weekly' ? 'weekly' : 'daily';
    const defaults: Record<Kind, TaskParams> = {
      regen: { amount: 10, intervalHours: 3, cap: 100 },
      stack: { period, amount: 1, cap: 7 },
      quota: { period, amount: 1 },
      check: { period },
      action: { period, actions: [{ id: 'a1', label: 'Erledigt', effects: [] }] },
    };
    setD((x) => ({ ...x, kind, params: { ...defaults[kind], minLevel: x.params.minLevel, warn: x.params.warn } }));
  };

  const error = validateTask(d);
  const actionTargets = targets.filter((t) => t.kind !== 'action');

  const updateAction = (idx: number, patch: Partial<ActionDef>) => {
    const actions = [...(p.actions ?? [])];
    actions[idx] = { ...actions[idx], ...patch };
    setP({ actions });
  };

  return (
    <form
      className="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (error) return;
        setBusy(true);
        try {
          await onSubmit({ ...d, addToAll });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label className="field span-2">
          <span>Name</span>
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder="z. B. Heiligtum: Ludra" autoFocus />
        </label>
        <div className="field span-2">
          <span>Symbol</span>
          <div className="icon-picker">
            {ICONS.map((i) => (
              <button type="button" key={i} className={d.icon === i ? 'active' : ''} onClick={() => set({ icon: i })} aria-label={`Symbol ${i}`}>
                {i}
              </button>
            ))}
            <input className="icon-input" value={d.icon} onChange={(e) => set({ icon: e.target.value })} maxLength={4} aria-label="Eigenes Symbol" />
          </div>
        </div>
        <label className="field">
          <span>Bereich</span>
          <select
            value={d.section}
            onChange={(e) => {
              const section = e.target.value as Section;
              set({ section, params: d.kind === 'regen' ? p : { ...p, period: section === 'weekly' ? 'weekly' : 'daily' } });
            }}
          >
            {(['daily', 'weekly'] as Section[]).map((s) => (
              <option key={s} value={s}>
                {SECTION_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Gilt für</span>
          <select value={d.scope} onChange={(e) => set({ scope: e.target.value as Scope })}>
            {(['character', 'account'] as Scope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="kind-picker">
        <legend>Art</legend>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <label key={k} className={`kind-option ${d.kind === k ? 'active' : ''}`}>
            <input type="radio" name="kind" checked={d.kind === k} onChange={() => changeKind(k)} />
            <strong>{KIND_LABEL[k]}</strong>
            <small>{KIND_HELP[k]}</small>
          </label>
        ))}
      </fieldset>

      <div className="form-grid">
        {d.kind !== 'regen' && (
          <label className="field">
            <span>{d.kind === 'stack' ? 'Nachschub' : d.kind === 'action' ? 'Nutzungen zählen' : 'Zurücksetzen'}</span>
            <select value={p.period ?? 'daily'} onChange={(e) => setP({ period: e.target.value as Period })}>
              {(['daily', 'weekly'] as Period[]).map((x) => (
                <option key={x} value={x}>
                  {PERIOD_LABEL[x]} (beim {x === 'daily' ? 'Daily' : 'Weekly'}-Reset)
                </option>
              ))}
            </select>
          </label>
        )}
        {d.kind === 'regen' && <NumberField label="Alle wie viele Stunden?" value={p.intervalHours} onChange={(v) => setP({ intervalHours: v ?? undefined })} />}
        {(d.kind === 'regen' || d.kind === 'stack') && (
          <>
            <NumberField label={d.kind === 'regen' ? 'Menge pro Intervall' : 'Menge pro Reset'} value={p.amount} onChange={(v) => setP({ amount: v ?? undefined })} />
            <NumberField label="Maximum" value={p.cap} onChange={(v) => setP({ cap: v ?? undefined })} hint="Bis hierhin wird automatisch aufgefüllt." />
            <NumberField label="Maximum mit Abo" optional value={p.capAbo} onChange={(v) => setP({ capAbo: v })} />
            <NumberField
              label="Extra-Vorrat aus Items bis"
              optional
              placeholder="leer = kein Extra-Vorrat"
              value={p.bonusCap}
              onChange={(v) => setP({ bonusCap: v })}
              hint="Für Tickets/Energie aus Items: zählt nicht gegen das Maximum und wird erst nach dem natürlichen Vorrat verbraucht."
            />
          </>
        )}
        {d.kind === 'regen' && (
          <label className="field">
            <span>
              Uhrzeit eines Ticks <em>(optional)</em>
            </span>
            <input value={p.anchor ?? ''} onChange={(e) => setP({ anchor: e.target.value || null })} placeholder="leer = Reset-Uhrzeit" maxLength={5} />
            <small className="muted">Zeitzone wie der Reset. Beispiel: Ticks um 01:00, 04:00, 07:00 … → „01:00“.</small>
          </label>
        )}
        {d.kind === 'quota' && (
          <>
            <NumberField label="Kontingent pro Reset" value={p.amount} onChange={(v) => setP({ amount: v ?? undefined })} />
            <NumberField label="Kontingent mit Abo" optional value={p.amountAbo} onChange={(v) => setP({ amountAbo: v })} />
          </>
        )}
        {(d.kind === 'regen' || d.kind === 'stack' || d.kind === 'quota') && (
          <>
            <NumberField label="Schrittweite Minus-Knopf" value={p.step ?? 1} onChange={(v) => setP({ step: v ?? undefined })} />
            <label className="field">
              <span>
                Einheit <em>(optional)</em>
              </span>
              <input value={p.unit ?? ''} onChange={(e) => setP({ unit: e.target.value || undefined })} maxLength={8} placeholder="z. B. Std." />
            </label>
          </>
        )}
        <NumberField label="Erst ab Stufe" optional placeholder="leer = alle Stufen" value={p.minLevel} onChange={(v) => setP({ minLevel: v })} step={1} />
        <label className="field checkbox-field">
          <input type="checkbox" checked={p.warn !== false} onChange={(e) => setP({ warn: e.target.checked ? undefined : false })} />
          <span>Warnungen anzeigen (Überlauf, verfällt bald)</span>
        </label>
      </div>

      {d.kind === 'action' && (
        <div className="actions-editor">
          <h3>Knöpfe</h3>
          {(p.actions ?? []).map((a, idx) => (
            <div key={idx} className="action-edit">
              <div className="row gap wrap">
                <input value={a.label} onChange={(e) => updateAction(idx, { label: e.target.value })} placeholder="Beschriftung" maxLength={30} />
                <label className="inline-check">
                  <input type="checkbox" checked={!!a.aboOnly} onChange={(e) => updateAction(idx, { aboOnly: e.target.checked || undefined })} /> nur mit Abo
                </label>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setP({ actions: (p.actions ?? []).filter((_, i) => i !== idx) })}>
                  Knopf löschen
                </button>
              </div>
              {a.effects.map((e, ei) => (
                <div key={ei} className="row gap wrap effect-row">
                  <span className="muted">wirkt auf</span>
                  <select
                    value={e.taskId}
                    onChange={(ev) => updateAction(idx, { effects: a.effects.map((x, i) => (i === ei ? { ...x, taskId: Number(ev.target.value) } : x)) })}
                  >
                    {actionTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.icon} {t.name}
                        {t.ownerId === null ? '' : ' (eigener)'}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="delta-input"
                    value={e.delta}
                    onChange={(ev) => updateAction(idx, { effects: a.effects.map((x, i) => (i === ei ? { ...x, delta: Number(ev.target.value) } : x)) })}
                    aria-label="Änderung"
                  />
                  <button type="button" className="icon-btn" onClick={() => updateAction(idx, { effects: a.effects.filter((_, i) => i !== ei) })} aria-label="Wirkung entfernen">
                    ✕
                  </button>
                </div>
              ))}
              {a.effects.length < 4 && actionTargets.length > 0 && (
                <button type="button" className="btn btn-small btn-ghost" onClick={() => updateAction(idx, { effects: [...a.effects, { taskId: actionTargets[0].id, delta: -1 }] })}>
                  + Wirkung
                </button>
              )}
            </div>
          ))}
          {(p.actions ?? []).length < 6 && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setP({ actions: [...(p.actions ?? []), { id: `a${Date.now().toString(36)}`, label: '', effects: [] }] })}
            >
              + Knopf
            </button>
          )}
          <p className="muted small">Negative Zahl = abziehen (z. B. −40 Odyl), positive = gutschreiben. Ohne Wirkung zählt der Knopf nur, wie oft er gedrückt wurde.</p>
        </div>
      )}

      <label className="field">
        <span>
          Hinweis <em>(optional, erscheint als ⓘ)</em>
        </span>
        <textarea value={d.note} onChange={(e) => set({ note: e.target.value })} maxLength={400} rows={2} />
      </label>

      {admin && (
        <div className="row gap wrap">
          <label className="inline-check">
            <input type="checkbox" checked={d.defaultOn !== false} onChange={(e) => set({ defaultOn: e.target.checked })} /> neuen Mitgliedern automatisch hinzufügen
          </label>
          {admin.isNew && (
            <label className="inline-check">
              <input type="checkbox" checked={addToAll} onChange={(e) => setAddToAll(e.target.checked)} /> allen bisherigen Mitgliedern hinzufügen
            </label>
          )}
        </div>
      )}

      {error && <p className="alert alert-warn">{error}</p>}
      <div className="row gap end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button className="btn btn-primary" disabled={!!error || busy}>
          {busy ? 'Speichere …' : submitLabel}
        </button>
      </div>
    </form>
  );
}
