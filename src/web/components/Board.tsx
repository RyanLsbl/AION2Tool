// Checkliste im Raster: Zeilen = Einträge, Spalten = Account + Charaktere (wie BynnArk).
// Auf dem Handy: ein Charakter pro Ansicht, server-weite Einträge stehen direkt mit drin.

import { useEffect, useMemo, useState } from 'react';
import {
  available, compute, fmtNum, hasBonus, levelOk, maxOf, periodOf, warningsFor, type Computed, type Ctx, type Warning,
} from '../../shared/engine';
import { formatDuration, formatWhen, nextReset, periodKey } from '../../shared/reset';
import { SECTION_LABEL, type ActionDef, type BoardItem, type Character, type Me, type Section, type TaskDef, type TaskState } from '../../shared/types';
import { put } from '../api';
import type { Session } from '../App';
import { stateKey, useBoard, type StateOp } from '../boardData';
import { CharStats, ClassIcon, Modal, Spinner, useErrorToast, useMedia, useNow, useToast } from '../ui';

/** Spalte im Raster. „auto“ = Handy-Ansicht: server-weite Einträge → Account, sonst der gewählte Charakter. */
type Column = { kind: 'account' } | { kind: 'char'; char: Character } | { kind: 'auto'; char: Character };

/** Kurzbeschreibung der Regel, z. B. „+15 alle 3 Std. · max. 560“. */
export function ruleText(t: TaskDef, abo: boolean): string {
  const p = t.params;
  const per = periodOf(t) === 'daily' ? 'Tag' : 'Woche';
  const max = maxOf(t, abo);
  const unit = p.unit ? ` ${p.unit}` : '';
  const extra = hasBonus(t) ? ` · Extra bis ${fmtNum(p.bonusCap ?? 0)}` : '';
  switch (t.kind) {
    case 'regen':
      return `+${fmtNum(p.amount ?? 0)} alle ${fmtNum(p.intervalHours ?? 0)} Std. · max. ${fmtNum(max ?? 0)}${extra}`;
    case 'stack':
      return `+${fmtNum(p.amount ?? 0)} pro ${per} · max. ${fmtNum(max ?? 0)}${extra}`;
    case 'quota':
      return `${fmtNum(max ?? 0)}${unit} pro ${per}`;
    case 'check':
      return periodOf(t) === 'daily' ? 'täglich abhaken' : 'wöchentlich abhaken';
    case 'action':
      return `zählt pro ${per}`;
  }
}

interface Editing {
  task: TaskDef;
  charId: number;
  computed: Computed;
  title: string;
}

export function Board({ session }: { session: Session }) {
  const { me, info } = session;
  const now = useNow(20_000);
  const narrow = useMedia('(max-width: 760px)');
  const { data, states, tasksById, error, change, action } = useBoard();
  const [editing, setEditing] = useState<Editing | null>(null);
  const chars = me.characters;
  const [selected, setSelected] = useState<number>(() => chars.find((c) => c.isMain)?.id ?? chars[0]?.id ?? 0);
  const ctx: Ctx = useMemo(() => ({ now, abo: me.abo, reset: info.reset }), [now, me.abo, info.reset]);

  const items = useMemo(
    () => (data?.items ?? []).filter((i) => !i.hidden && tasksById.has(i.taskId)).sort((a, b) => a.sort - b.sort),
    [data, tasksById],
  );
  const hasAccount = items.some((i) => tasksById.get(i.taskId)!.scope === 'account');
  const selectedChar = chars.find((c) => c.id === selected) ?? chars[0];
  const columns: Column[] = narrow
    ? selectedChar
      ? [{ kind: 'auto', char: selectedChar }]
      : []
    : [...(hasAccount ? [{ kind: 'account' as const }] : []), ...chars.map((char) => ({ kind: 'char' as const, char }))];

  // Alle Warnungen (für die Banner) und fehlende Startwerte
  const { warnings, missing } = useMemo(() => {
    const out: { key: string; task: TaskDef; who: string; w: Warning }[] = [];
    let missing = 0;
    for (const item of items) {
      const t = tasksById.get(item.taskId)!;
      const targets: { id: number; who: string }[] =
        t.scope === 'account'
          ? [{ id: 0, who: 'Account' }]
          : chars.filter((c) => !item.offChars.includes(c.id) && levelOk(t, c.level)).map((c) => ({ id: c.id, who: c.name }));
      for (const target of targets) {
        const c = compute(t, states.get(stateKey(t.id, target.id)), ctx);
        if (c.value == null) missing++;
        if (item.muted) continue;
        for (const w of warningsFor(t, c, ctx, me.prefs)) out.push({ key: `${t.id}:${target.id}:${w.level}`, task: t, who: target.who, w });
      }
    }
    const rank = { danger: 0, warn: 1, info: 2 };
    return { warnings: out.sort((a, b) => rank[a.w.level] - rank[b.w.level]), missing };
  }, [items, tasksById, states, chars, ctx, me.prefs]);

  if (error) return <p className="alert alert-danger">{error}</p>;
  if (!data) return <div className="center-block"><Spinner /></div>;

  const sections: Section[] = ['daily', 'weekly'];

  return (
    <div className="board-page">
      <div className="page-head">
        <div>
          <h1>Checkliste</h1>
          <p className="muted">
            Legion {info.legion} · {info.server}
          </p>
        </div>
        <AboSwitch me={me} session={session} />
      </div>
      <ResetBar ctx={ctx} />
      {missing > 0 && <FirstSteps missing={missing} />}
      <Banners warnings={warnings} ctx={ctx} />

      {items.length === 0 && (
        <div className="card empty">
          <h2>Deine Checkliste ist leer</h2>
          <p>
            Stell dir unter <a href="#/setup">Mein Setup</a> zusammen, was du täglich und wöchentlich erledigen willst.
          </p>
        </div>
      )}

      {narrow && items.length > 0 && chars.length > 1 && (
        <div className="char-tabs" role="tablist" aria-label="Charakter wählen">
          {chars.map((c) => (
            <button key={c.id} role="tab" aria-selected={selectedChar?.id === c.id} className={selectedChar?.id === c.id ? 'active' : ''} onClick={() => setSelected(c.id)}>
              <ClassIcon classKey={c.classKey} small />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className={`grid-wrap ${narrow ? 'grid-wrap-narrow' : ''}`}>
          <table className={`grid ${narrow ? 'grid-narrow' : ''}`}>
            <thead>
              <tr>
                <th className="grid-corner" scope="col">
                  Inhalt
                </th>
                {columns.map((col) => (
                  <th key={col.kind === 'account' ? 'acc' : col.char.id} className="col-head" scope="col" data-tour={col.kind === 'account' ? undefined : 'col-head'}>
                    {col.kind === 'account' ? <AccountHead /> : <CharHead c={col.char} />}
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map((section) => {
              const rows = items.filter((i) => tasksById.get(i.taskId)!.section === section);
              if (!rows.length) return null;
              const reset = nextReset(now, section, info.reset);
              return (
                <tbody key={section}>
                  <tr className="section-row">
                    <th colSpan={columns.length + 1} scope="colgroup">
                      <span>{SECTION_LABEL[section]}</span>
                      <small>
                        Reset in {formatDuration(reset - now)} · {formatWhen(reset, now)}
                      </small>
                    </th>
                  </tr>
                  {rows.map((item) => (
                    <Row
                      key={item.taskId}
                      item={item}
                      task={tasksById.get(item.taskId)!}
                      columns={columns}
                      states={states}
                      tasksById={tasksById}
                      ctx={ctx}
                      me={me}
                      onChange={(t, charId, op, label) => void change(t.id, charId, op, label)}
                      onEdit={(e) => setEditing(e)}
                      onAction={(t, charId, a, label) => void action(t.id, charId, a, label)}
                    />
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {editing && (
        <ValueEditor
          editing={editing}
          abo={me.abo}
          onClose={() => setEditing(null)}
          onSave={async (op) => {
            if (await change(editing.task.id, editing.charId, op, `${editing.task.name} gespeichert`)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AccountHead() {
  return (
    <div className="col-head-inner">
      <span className="class-icon account-icon" aria-hidden>
        🏠
      </span>
      <div>
        <strong>Account</strong>
        <small className="muted">server-weit</small>
      </div>
    </div>
  );
}

function CharHead({ c }: { c: Character }) {
  return (
    <div className="col-head-inner">
      <ClassIcon classKey={c.classKey} />
      <div>
        <strong>
          {c.name}
          {c.isMain && (
            <span className="main-star" title="Main">
              ★
            </span>
          )}
        </strong>
        <CharStats c={c} />
      </div>
    </div>
  );
}

function AboSwitch({ me, session }: { me: Me; session: Session }) {
  const onError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await put<{ me: Me }>('/api/me/settings', { abo: !me.abo });
      session.setMe(r.me);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label data-tour="abo" className={`switch-label ${me.abo ? 'on' : ''}`} title="Spezielle Quai-Mitgliedschaft: höhere Maxima (z. B. Odyl 840, Shugo-Schlüssel 21) und doppeltes Öffnen des Kubus">
      <input type="checkbox" checked={me.abo} onChange={toggle} disabled={busy} />
      <span className="switch" aria-hidden />
      <span>
        Abo <strong>{me.abo ? 'aktiv' : 'aus'}</strong>
      </span>
    </label>
  );
}

function ResetBar({ ctx }: { ctx: Ctx }) {
  const daily = nextReset(ctx.now, 'daily', ctx.reset);
  const weekly = nextReset(ctx.now, 'weekly', ctx.reset);
  return (
    <div className="reset-bar" data-tour="reset">
      <div className="reset-chip">
        <span className="reset-label">Daily-Reset</span>
        <strong>{formatDuration(daily - ctx.now)}</strong>
        <small>{formatWhen(daily, ctx.now)}</small>
      </div>
      <div className="reset-chip">
        <span className="reset-label">Weekly-Reset</span>
        <strong>{formatDuration(weekly - ctx.now)}</strong>
        <small>{formatWhen(weekly, ctx.now)}</small>
      </div>
    </div>
  );
}

function FirstSteps({ missing }: { missing: number }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('firstStepsHidden') === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <div className="banner banner-info first-steps">
      <span className="banner-icon" aria-hidden>
        👋
      </span>
      <span className="banner-text">
        <strong>Erste Schritte</strong>
        Trag bei {missing === 1 ? 'einem Feld' : `${missing} Feldern`} einmal deinen aktuellen Stand aus dem Spiel ein (Knopf „Stand eintragen“). Danach rechnet das Tool
        Nachschub und Resets selbst – du drückst nur noch „−“, wenn du etwas benutzt.
      </span>
      <button
        className="icon-btn"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem('firstStepsHidden', '1');
          } catch {
            // Speicher nicht verfügbar
          }
        }}
        aria-label="Hinweis ausblenden"
      >
        ✕
      </button>
    </div>
  );
}

// ---- Banner ----

function dismissKey(ctx: Ctx): string {
  return `dismissed:${periodKey(ctx.now, 'daily', ctx.reset)}`;
}

function loadDismissed(ctx: Ctx): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(dismissKey(ctx)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function Banners({ warnings, ctx }: { warnings: { key: string; task: TaskDef; who: string; w: Warning }[]; ctx: Ctx }) {
  const day = periodKey(ctx.now, 'daily', ctx.reset);
  const [dismissed, setDismissed] = useState(() => loadDismissed(ctx));
  const [expanded, setExpanded] = useState(false);
  // Ausgeblendete Hinweise gelten bis zum nächsten Daily-Reset
  useEffect(() => setDismissed(loadDismissed(ctx)), [day]);

  const visible = warnings.filter((w) => !dismissed.has(w.key));
  if (!visible.length) return null;
  const dismiss = (key: string) => {
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('dismissed:') && k !== dismissKey(ctx)) localStorage.removeItem(k);
      }
      localStorage.setItem(dismissKey(ctx), JSON.stringify([...next]));
    } catch {
      // Speicher nicht verfügbar – nur für diese Sitzung ausgeblendet
    }
  };
  const shown = expanded ? visible : visible.slice(0, 4);
  return (
    <section className="banners" aria-label="Hinweise" data-tour="banners">
      {shown.map(({ key, task, who, w }) => (
        <div key={key} className={`banner banner-${w.level}`} role={w.level === 'danger' ? 'alert' : undefined}>
          <span className="banner-icon" aria-hidden>
            {task.icon}
          </span>
          <span className="banner-text">
            <strong>
              {task.name} <span className="banner-who">· {who}</span>
            </strong>
            {w.text}
          </span>
          <button className="icon-btn" onClick={() => dismiss(key)} title="Bis zum nächsten Daily-Reset ausblenden" aria-label="Hinweis ausblenden">
            ✕
          </button>
        </div>
      ))}
      {visible.length > 4 && (
        <button className="btn btn-small btn-ghost" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Weniger anzeigen' : `${visible.length - 4} weitere Hinweise anzeigen`}
        </button>
      )}
    </section>
  );
}

// ---- Zeilen & Zellen ----

interface RowProps {
  item: BoardItem;
  task: TaskDef;
  columns: Column[];
  states: Map<string, TaskState>;
  tasksById: Map<number, TaskDef>;
  ctx: Ctx;
  me: Me;
  onChange: (t: TaskDef, charId: number, op: StateOp, label: string) => void;
  onEdit: (e: Editing) => void;
  onAction: (t: TaskDef, charId: number, actionId: string, label: string) => void;
}

function Row({ item, task, columns, states, tasksById, ctx, me, onChange, onEdit, onAction }: RowProps) {
  return (
    <tr>
      <th className="row-head" scope="row">
        <div className="row-title">
          <span className="row-icon" aria-hidden>
            {task.icon}
          </span>
          <div className="row-text">
            <strong>{task.name}</strong>
            <small>
              {ruleText(task, me.abo)}
              {task.scope === 'account' && <span className="tag">server-weit</span>}
              {task.ownerId !== null && <span className="tag tag-own">eigener</span>}
            </small>
          </div>
          {task.note && (
            <span className="info-dot" title={task.note} tabIndex={0} role="note" aria-label={task.note} data-tour="info">
              i
            </span>
          )}
        </div>
      </th>
      {columns.map((col) => {
        const key = col.kind === 'account' ? 'acc' : col.char.id;
        const target = cellTarget(task, col);
        if (!target || (target.char && item.offChars.includes(target.char.id))) return <td key={key} className="cell cell-empty" aria-hidden />;
        if (target.char && !levelOk(task, target.char.level)) {
          return (
            <td key={key} className="cell cell-locked">
              <span>ab Stufe {task.params.minLevel}</span>
            </td>
          );
        }
        const { charId, who } = target;
        const c = compute(task, states.get(stateKey(task.id, charId)), ctx);
        const warns = item.muted ? [] : warningsFor(task, c, ctx, me.prefs);
        const level = warns.some((w) => w.level === 'danger') ? 'danger' : warns.some((w) => w.level === 'warn') ? 'warn' : '';
        const title = `${task.name} · ${who}`;
        return (
          <td key={key} className={`cell ${level ? `cell-${level}` : ''}`} title={warns.map((w) => w.text).join('\n') || undefined}>
            {task.kind === 'action' ? (
              <ActionCell
                task={task}
                c={c}
                charId={charId}
                abo={me.abo}
                states={states}
                tasksById={tasksById}
                ctx={ctx}
                onAction={(a) => onAction(task, charId, a.id, `${task.name} (${who}): ${a.label}`)}
              />
            ) : (
              <Cell
                task={task}
                c={c}
                ctx={ctx}
                title={title}
                onDelta={(d) => onChange(task, charId, { delta: d }, `${task.name} (${who}) ${d < 0 ? '−' : '+'}${fmtNum(Math.abs(d))}`)}
                onEdit={() => onEdit({ task, charId, computed: c, title })}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

/** Welcher Stand gehört in diese Spalte? null = Zelle bleibt leer. */
function cellTarget(task: TaskDef, col: Column): { charId: number; who: string; char: Character | null } | null {
  if (task.scope === 'account') return col.kind === 'char' ? null : { charId: 0, who: 'Account', char: null };
  if (col.kind === 'account') return null;
  return { charId: col.char.id, who: col.char.name, char: col.char };
}

/** Warum ein Knopf gerade nicht geht (z. B. nicht genug Odyl) – oder null. */
function actionBlocker(a: ActionDef, charId: number, states: Map<string, TaskState>, tasksById: Map<number, TaskDef>, ctx: Ctx): string | null {
  for (const e of a.effects) {
    if (e.delta >= 0) continue;
    const target = tasksById.get(e.taskId);
    if (!target || target.kind === 'action') continue;
    const targetChar = target.scope === 'account' ? 0 : charId;
    const c = compute(target, states.get(stateKey(target.id, targetChar)), ctx);
    if (c.value == null) return `Trag zuerst deinen aktuellen Stand bei „${target.name}“ ein.`;
    if (available(c) < -e.delta) return `Nicht genug ${target.name}: ${fmtNum(available(c))} vorhanden, ${fmtNum(-e.delta)} nötig.`;
  }
  return null;
}

function ActionCell({
  task, c, charId, abo, states, tasksById, ctx, onAction,
}: {
  task: TaskDef;
  c: Computed;
  charId: number;
  abo: boolean;
  states: Map<string, TaskState>;
  tasksById: Map<number, TaskDef>;
  ctx: Ctx;
  onAction: (a: ActionDef) => void;
}) {
  const toast = useToast();
  const actions = (task.params.actions ?? []).filter((a) => !a.aboOnly || abo);
  return (
    <div className="cell-actions" data-tour="actions">
      {actions.map((a) => {
        const blocker = actionBlocker(a, charId, states, tasksById, ctx);
        return (
          <button
            key={a.id}
            className={`btn btn-small btn-action ${blocker ? 'is-blocked' : ''}`}
            aria-disabled={!!blocker}
            title={blocker ?? a.label}
            onClick={() => (blocker ? toast({ kind: 'error', text: blocker }) : onAction(a))}
          >
            {a.label}
          </button>
        );
      })}
      <small className="counter-hint">
        {periodOf(task) === 'daily' ? 'heute' : 'diese Woche'}: {fmtNum(c.value ?? 0)}×
      </small>
    </div>
  );
}

function Cell({ task, c, ctx, title, onDelta, onEdit }: { task: TaskDef; c: Computed; ctx: Ctx; title: string; onDelta: (d: number) => void; onEdit: () => void }) {
  const step = task.params.step ?? 1;
  const unit = task.params.unit ? ` ${task.params.unit}` : '';

  if (task.kind === 'check') {
    const done = (c.value ?? 1) <= 0;
    return (
      <button className={`check-btn ${done ? 'done' : ''}`} onClick={() => onDelta(done ? 1 : -1)} aria-pressed={done} title={title}>
        <span className="check-box" aria-hidden>
          {done ? '✓' : ''}
        </span>
        {done ? 'erledigt' : 'offen'}
      </button>
    );
  }

  if (c.value == null) {
    return (
      <button className="btn btn-small btn-outline set-btn" onClick={onEdit} title={`${title}: aktuellen Stand aus dem Spiel eintragen`} data-tour="set-stand">
        Stand eintragen
      </button>
    );
  }

  const max = c.max ?? 0;
  const pct = max > 0 ? Math.min(100, (c.value / max) * 100) : 0;
  const bonus = hasBonus(task);
  let hint = '';
  if (task.kind === 'regen' && c.nextAt) {
    hint = c.value >= max ? 'voll' : `+${fmtNum(c.nextGain ?? 0)} in ${formatDuration(c.nextAt - ctx.now)}`;
  } else if (task.kind === 'stack' && c.nextAt) {
    hint = c.value >= max ? 'voll' : `+${fmtNum(c.nextGain ?? 0)} ${formatWhen(c.nextAt, ctx.now)}`;
  } else if (task.kind === 'quota') {
    hint = c.value <= 0 ? 'erledigt ✓' : `bis ${formatWhen(c.nextAt ?? 0, ctx.now)}`;
  }
  const done = task.kind === 'quota' && c.value <= 0;
  const empty = available(c) <= 0;

  return (
    <div className={`counter ${done ? 'counter-done' : ''}`} data-tour="counter">
      <div className="counter-top">
        <button className="step-btn" onClick={() => onDelta(-step)} disabled={empty} aria-label={`${title}: ${fmtNum(step)} benutzt`} title={`−${fmtNum(step)} benutzt`}>
          −
        </button>
        <button className="counter-value" onClick={onEdit} title={`${title}: Stand bearbeiten`}>
          <strong>{fmtNum(c.value)}</strong>
          <span className="counter-max">
            /{fmtNum(max)}
            {unit}
          </span>
          {c.bonus > 0 && (
            <span className="bonus-pill" title={`Extra-Vorrat aus Items: ${fmtNum(c.bonus)}`}>
              +{fmtNum(c.bonus)}
            </span>
          )}
        </button>
        <button
          className="step-btn"
          onClick={() => onDelta(step)}
          aria-label={`${title}: +${fmtNum(step)}${bonus ? ' in den Extra-Vorrat' : ''}`}
          title={bonus ? `+${fmtNum(step)} in den Extra-Vorrat (z. B. aus einem Item)` : `+${fmtNum(step)}`}
        >
          +
        </button>
      </div>
      <div className="bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <small className="counter-hint">{hint}</small>
    </div>
  );
}

function ValueEditor({ editing, abo, onClose, onSave }: { editing: Editing; abo: boolean; onClose: () => void; onSave: (op: StateOp) => Promise<void> }) {
  const { task, computed, title } = editing;
  const bonusPool = hasBonus(task);
  const [value, setValue] = useState(computed.value != null ? String(computed.value) : '');
  const [bonus, setBonus] = useState(String(computed.bonus));
  const [delta, setDelta] = useState('');
  const [busy, setBusy] = useState(false);
  const unit = task.params.unit ? ` ${task.params.unit}` : '';
  const max = computed.max;
  // Komma als Dezimaltrenner, typografisches Minus und führendes Plus erlauben
  const parse = (s: string) => Number(s.trim().replace(',', '.').replace(/^\u2212/, '-').replace(/^\+/, ''));
  const v = parse(value);
  const b = parse(bonus);
  const d = parse(delta);
  const validValue = value.trim() !== '' && Number.isFinite(v) && v >= 0;
  const validBonus = !bonusPool || (bonus.trim() !== '' && Number.isFinite(b) && b >= 0);

  const save = async (op: StateOp) => {
    setBusy(true);
    try {
      await onSave(op);
    } finally {
      setBusy(false);
    }
  };
  const label =
    task.kind === 'quota' ? `Noch übrig ${periodOf(task) === 'daily' ? 'heute' : 'diese Woche'}${unit}` : bonusPool ? `Natürlicher Vorrat im Spiel${unit}` : `Aktueller Stand im Spiel${unit}`;

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (validValue && validBonus) void save({ value: v, ...(bonusPool ? { bonus: b } : {}) });
        }}
      >
        <label className="field">
          <span>{label}</span>
          <div className="row gap">
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={max != null ? `0 – ${fmtNum(max)}` : ''} />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setValue('0')}>
              0
            </button>
            {max != null && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setValue(String(max))}>
                voll ({fmtNum(max)})
              </button>
            )}
          </div>
          <small className="muted">Ab diesem Wert rechnet das Tool selbst weiter ({ruleText(task, abo)}).</small>
        </label>
        {bonusPool && (
          <label className="field">
            <span>Extra-Vorrat aus Items</span>
            <input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="0" />
            <small className="muted">
              Bis {fmtNum(task.params.bonusCap ?? 0)}. Wird nicht aufgefüllt, verfällt nicht und wird erst nach dem natürlichen Vorrat verbraucht.
            </small>
          </label>
        )}
        <button className="btn btn-primary" disabled={busy || !validValue || !validBonus}>
          Stand speichern
        </button>
      </form>
      <div className="divider">
        <span>oder</span>
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (Number.isFinite(d) && d !== 0) void save({ delta: d });
        }}
      >
        <label className="field">
          <span>Erhalten oder verbraucht</span>
          <div className="row gap">
            <input inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+5 oder −40" />
            <button className="btn" disabled={busy || !delta.trim() || !Number.isFinite(d) || d === 0}>
              Übernehmen
            </button>
          </div>
          <small className="muted">
            {bonusPool
              ? 'Plus landet im Extra-Vorrat (z. B. Ticket oder Energie aus einem Item), Minus zieht zuerst vom natürlichen Vorrat ab.'
              : 'Plus erhöht, Minus verringert den Stand.'}
          </small>
        </label>
      </form>
    </Modal>
  );
}
