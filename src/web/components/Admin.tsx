// Admin-Bereich für Offiziere.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtNum } from '../../shared/engine';
import { SECTION_LABEL, type Access, type Character, type Section, type TaskDef } from '../../shared/types';
import { get, post, put, del } from '../api';
import type { Session } from '../App';
import { ClassIcon, fmtInt, Modal, Spinner, timeAgo, useErrorToast, useNow, useToast } from '../ui';
import { ruleText } from './Board';
import type { Catalog, TemplateInfo } from './Builder';
import { draftFrom, emptyDraft, TaskForm } from './TaskForm';

const TABS = [
  { id: 'standard', label: 'Standard-Einträge', icon: '📋' },
  { id: 'members', label: 'Mitglieder', icon: '👥' },
  { id: 'claims', label: 'Anfragen', icon: '❓' },
  { id: 'progress', label: 'Fortschritt', icon: '📊' },
  { id: 'templates', label: 'Vorlagen', icon: '📦' },
  { id: 'log', label: 'Protokoll', icon: '📝' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Admin({ session, tab }: { session: Session; tab: string }) {
  const active: TabId = (TABS.find((t) => t.id === tab)?.id ?? 'standard') as TabId;
  const [openClaims, setOpenClaims] = useState(0);
  useEffect(() => {
    get<{ claims: ClaimInfo[] }>('/api/admin/claims')
      .then((r) => setOpenClaims(r.claims.filter((c) => c.status === 'open').length))
      .catch(() => undefined);
  }, [tab]);
  return (
    <div className="admin-page">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="muted">Für Offiziere der Legion {session.info.legion}.</p>
        </div>
      </div>
      <nav className="tabs admin-tabs" aria-label="Admin-Bereiche">
        {TABS.map((t) => (
          <a key={t.id} href={`#/admin/${t.id}`} className={active === t.id ? 'active' : ''} aria-current={active === t.id ? 'page' : undefined}>
            <span aria-hidden>{t.icon}</span> {t.label}
            {t.id === 'claims' && openClaims > 0 && <span className="count-badge">{openClaims}</span>}
          </a>
        ))}
      </nav>
      {active === 'standard' && <StandardTab session={session} />}
      {active === 'members' && <MembersTab session={session} />}
      {active === 'claims' && <ClaimsTab onChange={setOpenClaims} />}
      {active === 'progress' && <ProgressTab />}
      {active === 'templates' && <TemplatesTab />}
      {active === 'log' && <LogTab />}
    </div>
  );
}

function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await get<T>(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url]);
  useEffect(() => void load(), [load]);
  return { data, error, load };
}

function Loading({ error }: { error: string | null }) {
  return error ? <p className="alert alert-danger">{error}</p> : <div className="center-block"><Spinner /></div>;
}

// ---------- Standard-Einträge ----------

function StandardTab({ session }: { session: Session }) {
  const { data, error, load } = useLoad<{ tasks: TaskDef[] }>('/api/admin/standard');
  const [editing, setEditing] = useState<TaskDef | 'new' | null>(null);
  const toast = useToast();
  const onError = useErrorToast();
  if (!data) return <Loading error={error} />;
  const tasks = data.tasks;
  const activeTargets = tasks.filter((t) => t.active);

  const move = async (section: Section, id: number, dir: -1 | 1) => {
    const list = tasks.filter((t) => t.section === section);
    const idx = list.findIndex((t) => t.id === id);
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    const other = tasks.filter((t) => t.section !== section);
    const ids = (section === 'daily' ? [...list, ...other] : [...other, ...list]).map((t) => t.id);
    try {
      await put('/api/admin/standard/order', { ids });
      void load();
    } catch (e) {
      onError(e);
    }
  };

  const setActive = async (t: TaskDef, activeNow: boolean) => {
    if (!activeNow && !confirm(`„${t.name}“ deaktivieren? Der Eintrag verschwindet aus allen Checklisten (Stände bleiben erhalten und kommen beim Aktivieren zurück).`)) return;
    try {
      await post(`/api/admin/standard/${t.id}/active`, { active: activeNow });
      toast({ kind: 'ok', text: activeNow ? `„${t.name}“ aktiviert und allen hinzugefügt.` : `„${t.name}“ deaktiviert.` });
      void load();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <>
      <div className="row gap wrap between">
        <p className="muted">
          Diese Einträge bekommen alle Mitglieder als Standard. Nach einem Patch hier die Werte anpassen – die Änderung gilt sofort für alle (gespeicherte Stände bleiben).
        </p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          ＋ Neuer Standard-Eintrag
        </button>
      </div>
      {(['daily', 'weekly'] as Section[]).map((section) => {
        const list = tasks.filter((t) => t.section === section);
        return (
          <section key={section} className="card builder-section">
            <h2>{SECTION_LABEL[section]}</h2>
            <ul className="builder-list">
              {list.map((t, idx) => (
                <li key={t.id} className={`builder-item ${t.active ? '' : 'is-hidden'}`}>
                  <div className="builder-move">
                    <button className="icon-btn" disabled={idx === 0} onClick={() => void move(section, t.id, -1)} aria-label={`${t.name} nach oben`}>
                      ▲
                    </button>
                    <button className="icon-btn" disabled={idx === list.length - 1} onClick={() => void move(section, t.id, 1)} aria-label={`${t.name} nach unten`}>
                      ▼
                    </button>
                  </div>
                  <span className="row-icon" aria-hidden>
                    {t.icon}
                  </span>
                  <div className="builder-main">
                    <strong>{t.name}</strong>
                    <small className="muted">
                      {ruleText(t, false)}
                      {t.scope === 'account' && <span className="tag">server-weit</span>}
                      {!t.defaultOn && <span className="tag">nicht automatisch</span>}
                      {!t.active && <span className="tag tag-warn">deaktiviert</span>}
                    </small>
                  </div>
                  <div className="builder-actions">
                    <button className="btn btn-small" onClick={() => setEditing(t)}>
                      Bearbeiten
                    </button>
                    <button className="btn btn-small btn-ghost" onClick={() => void setActive(t, !t.active)}>
                      {t.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {editing && (
        <Modal title={editing === 'new' ? 'Neuer Standard-Eintrag' : `„${editing.name}“ bearbeiten`} onClose={() => setEditing(null)} wide>
          <TaskForm
            initial={editing === 'new' ? { ...emptyDraft(), defaultOn: true } : draftFrom(editing)}
            targets={editing === 'new' ? activeTargets : activeTargets.filter((t) => t.id !== editing.id)}
            submitLabel={editing === 'new' ? 'Anlegen' : 'Speichern'}
            admin={{ isNew: editing === 'new' }}
            onCancel={() => setEditing(null)}
            onSubmit={async (d) => {
              try {
                if (editing === 'new') await post('/api/admin/standard', d);
                else await put(`/api/admin/standard/${editing.id}`, d);
                toast({ kind: 'ok', text: `„${d.name}“ gespeichert.` });
                setEditing(null);
                void load();
              } catch (e) {
                onError(e);
              }
            }}
          />
        </Modal>
      )}
      <p className="muted small">Angemeldet als {session.me.name}. Jede Änderung wird im Protokoll festgehalten.</p>
    </>
  );
}

// ---------- Mitglieder ----------

interface MemberInfo {
  id: number;
  steamId: string;
  name: string;
  avatar: string | null;
  officer: boolean;
  owner: boolean;
  blocked: boolean;
  access: Access;
  legionStatus: string | null;
  legionSeen: string | null;
  legionCheckedAt: number | null;
  lastLogin: number | null;
  createdAt: number;
  characters: Character[];
}

const ACCESS_LABEL: Record<Access, { text: string; cls: string }> = {
  ok: { text: '✅ Mitglied', cls: 'badge-ok' },
  pending: { text: '⏳ wartet', cls: 'badge-warn' },
  left: { text: '🚪 ausgetreten', cls: 'badge-danger' },
  blocked: { text: '⛔ gesperrt', cls: 'badge-danger' },
  'needs-main': { text: '— kein Main', cls: 'badge-muted' },
};

function MembersTab({ session }: { session: Session }) {
  const { data, error, load } = useLoad<{ members: MemberInfo[] }>('/api/admin/members');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Access | 'officer'>('all');
  const [open, setOpen] = useState<number | null>(null);
  const now = useNow(60_000);
  const toast = useToast();
  const onError = useErrorToast();
  if (!data) return <Loading error={error} />;

  const q = query.trim().toLowerCase();
  const members = data.members.filter((m) => {
    if (filter === 'officer' ? !(m.officer || m.owner) : filter !== 'all' && m.access !== filter) return false;
    return !q || m.name.toLowerCase().includes(q) || m.characters.some((c) => c.name.toLowerCase().includes(q));
  });
  const count = (a: Access) => data.members.filter((m) => m.access === a).length;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = (await fn()) as { error?: string } | undefined;
      toast(r?.error ? { kind: 'error', text: r.error } : { kind: 'ok', text: ok });
      void load();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <>
      <div className="row gap wrap filter-bar">
        <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen (Steam-Name oder Charakter)" aria-label="Mitglieder suchen" />
        <div className="segmented" role="radiogroup" aria-label="Filter">
          {(
            [
              ['all', `Alle (${data.members.length})`],
              ['ok', `Mitglieder (${count('ok')})`],
              ['pending', `Wartend (${count('pending')})`],
              ['left', `Ausgetreten (${count('left')})`],
              ['blocked', `Gesperrt (${count('blocked')})`],
              ['officer', 'Offiziere'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="member-list">
        {members.map((m) => {
          const main = m.characters.find((c) => c.isMain);
          const st = ACCESS_LABEL[m.access];
          return (
            <li key={m.id} className="card member">
              <div className="member-row">
                {m.avatar ? <img className="avatar" src={m.avatar} alt="" width={36} height={36} /> : <span className="avatar avatar-fallback">{m.name.slice(0, 1)}</span>}
                <div className="member-main">
                  <strong>
                    {m.name}
                    {m.owner && <span className="badge badge-gold">Haupt-Admin</span>}
                    {!m.owner && m.officer && <span className="badge badge-blue">Offizier</span>}
                  </strong>
                  <small className="muted">
                    {main ? (
                      <>
                        Main {main.name} · KK {fmtInt(main.combatPower)} · GS {fmtInt(main.itemLevel)}
                      </>
                    ) : (
                      'kein Main eingetragen'
                    )}{' '}
                    · zuletzt da {timeAgo(m.lastLogin, now)}
                  </small>
                </div>
                <div className="member-status">
                  <span className={`badge ${st.cls}`}>{st.text}</span>
                  {m.legionCheckedAt && (
                    <small className="muted">
                      PlayNC: {m.legionSeen ?? 'keine Legion'} ({timeAgo(m.legionCheckedAt, now)})
                    </small>
                  )}
                </div>
                <button className="btn btn-small btn-ghost" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                  {open === m.id ? 'Weniger' : 'Details'}
                </button>
              </div>
              {open === m.id && (
                <div className="member-details">
                  <ul className="mini-chars">
                    {m.characters.map((c) => (
                      <li key={c.id}>
                        <ClassIcon classKey={c.classKey} small />
                        <span>
                          {c.name}
                          {c.isMain && ' ★'} · Lv. {c.level ?? '–'} · {c.legion ?? 'keine Legion'}
                        </span>
                        <button
                          className="btn btn-small btn-ghost danger"
                          onClick={() => {
                            if (confirm(`${c.name} von ${m.name} lösen? Danach kann jemand anderes den Charakter eintragen.`)) {
                              void act(() => del(`/api/admin/characters/${c.id}`), `${c.name} gelöst.`);
                            }
                          }}
                        >
                          Lösen
                        </button>
                      </li>
                    ))}
                    {m.characters.length === 0 && <li className="muted">Keine Charaktere.</li>}
                  </ul>
                  <div className="row gap wrap">
                    {main && (
                      <button className="btn btn-small" onClick={() => void act(() => post(`/api/admin/members/${m.id}/recheck`), `${m.name} geprüft.`)}>
                        🔄 Legion jetzt prüfen
                      </button>
                    )}
                    {!m.owner && (
                      <button
                        className={`btn btn-small ${m.blocked ? '' : 'btn-danger'}`}
                        onClick={() => {
                          if (m.blocked || confirm(`${m.name} sperren? Alle Sitzungen werden beendet.`)) {
                            void act(() => post(`/api/admin/members/${m.id}`, { blocked: !m.blocked }), m.blocked ? `${m.name} entsperrt.` : `${m.name} gesperrt.`);
                          }
                        }}
                      >
                        {m.blocked ? 'Entsperren' : '⛔ Sperren'}
                      </button>
                    )}
                    {session.me.isOwner && !m.owner && (
                      <button
                        className="btn btn-small"
                        onClick={() => void act(() => post(`/api/admin/members/${m.id}`, { officer: !m.officer }), m.officer ? `${m.name} ist kein Offizier mehr.` : `${m.name} ist jetzt Offizier.`)}
                      >
                        {m.officer ? 'Offiziersrechte entziehen' : '🎖️ Zum Offizier machen'}
                      </button>
                    )}
                  </div>
                  <small className="muted">
                    Steam-ID {m.steamId} · registriert {timeAgo(m.createdAt, now)}
                  </small>
                </div>
              )}
            </li>
          );
        })}
        {members.length === 0 && <li className="muted">Keine Treffer.</li>}
      </ul>
    </>
  );
}

// ---------- Anfragen ----------

interface ClaimInfo {
  id: number;
  name: string;
  asMain: boolean;
  note: string;
  status: 'open' | 'done' | 'rejected';
  createdAt: number;
  claimant: string;
  owner: string | null;
}

function ClaimsTab({ onChange }: { onChange: (open: number) => void }) {
  const { data, error, load } = useLoad<{ claims: ClaimInfo[] }>('/api/admin/claims');
  const toast = useToast();
  const onError = useErrorToast();
  const now = useNow(60_000);
  useEffect(() => {
    if (data) onChange(data.claims.filter((c) => c.status === 'open').length);
  }, [data, onChange]);
  if (!data) return <Loading error={error} />;

  const resolve = async (c: ClaimInfo, action: 'transfer' | 'reject') => {
    if (action === 'transfer' && !confirm(`${c.name} von ${c.owner ?? '?'} an ${c.claimant} übertragen?`)) return;
    try {
      await post(`/api/admin/claims/${c.id}`, { action });
      toast({ kind: 'ok', text: action === 'transfer' ? `${c.name} übertragen.` : 'Anfrage abgelehnt.' });
      void load();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <>
      <p className="muted">
        Trägt jemand einen Charakter ein, der schon einem anderen Account gehört, landet die Anfrage hier. Im Zweifel im Discord nachfragen, wem der Charakter wirklich gehört.
      </p>
      <ul className="member-list">
        {data.claims.map((c) => (
          <li key={c.id} className={`card member ${c.status !== 'open' ? 'is-done' : ''}`}>
            <div className="member-row">
              <span className="row-icon" aria-hidden>
                {c.status === 'open' ? '❓' : c.status === 'done' ? '✅' : '✖️'}
              </span>
              <div className="member-main">
                <strong>
                  {c.claimant} beansprucht {c.name}
                  {c.asMain && ' (als Main)'}
                </strong>
                <small className="muted">
                  gehört derzeit {c.owner ?? 'niemandem'} · {timeAgo(c.createdAt, now)}
                </small>
                {c.note && <p className="claim-note">„{c.note}“</p>}
              </div>
              {c.status === 'open' && (
                <div className="row gap">
                  <button className="btn btn-small btn-primary" onClick={() => void resolve(c, 'transfer')}>
                    Übertragen
                  </button>
                  <button className="btn btn-small btn-ghost" onClick={() => void resolve(c, 'reject')}>
                    Ablehnen
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
        {data.claims.length === 0 && <li className="muted">Keine Anfragen.</li>}
      </ul>
    </>
  );
}

// ---------- Fortschritt ----------

interface ProgressRow {
  userId: number;
  name: string;
  abo: boolean;
  lastActivity: number | null;
  characters: { id: number; name: string; isMain: boolean; classKey: string | null; combatPower: number | null; itemLevel: number | null }[];
  cells: Record<number, { charId: number; value: number | null; bonus: number; max: number | null }[]>;
}

function ProgressTab() {
  const { data, error } = useLoad<{ tasks: TaskDef[]; rows: ProgressRow[] }>('/api/admin/progress');
  const [section, setSection] = useState<Section>('weekly');
  const [twinks, setTwinks] = useState(false);
  const now = useNow(60_000);
  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => t.section === section), [data, section]);
  if (!data) return <Loading error={error} />;

  const cellClass = (t: TaskDef, v: number | null, max: number | null) => {
    if (v == null || max == null) return 'p-empty';
    if (t.kind === 'quota' || t.kind === 'check') return v <= 0 ? 'p-done' : v >= max ? 'p-open' : 'p-part';
    return v >= max ? 'p-full' : 'p-part';
  };
  const cellText = (t: TaskDef, v: number | null, bonus: number, max: number | null) => {
    if (v == null) return '–';
    if (t.kind === 'check') return v <= 0 ? '✓' : '○';
    if ((t.kind === 'quota') && v <= 0) return '✓';
    return `${fmtNum(v)}/${fmtNum(max ?? 0)}${bonus > 0 ? ` +${fmtNum(bonus)}` : ''}`;
  };

  return (
    <>
      <div className="row gap wrap filter-bar">
        <div className="segmented" role="radiogroup" aria-label="Bereich">
          {(['weekly', 'daily'] as Section[]).map((s) => (
            <button key={s} role="radio" aria-checked={section === s} className={section === s ? 'active' : ''} onClick={() => setSection(s)}>
              {SECTION_LABEL[s]}
            </button>
          ))}
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={twinks} onChange={(e) => setTwinks(e.target.checked)} /> Twinks anzeigen
        </label>
        <span className="muted small">
          <span className="legend p-done">✓ erledigt</span> <span className="legend p-part">teilweise</span> <span className="legend p-open">offen</span>{' '}
          <span className="legend p-full">voll / läuft über</span>
        </span>
      </div>
      <div className="grid-wrap">
        <table className="grid progress-grid">
          <thead>
            <tr>
              <th className="grid-corner">Mitglied</th>
              {tasks.map((t) => (
                <th key={t.id} className="col-head progress-head" title={t.name}>
                  <span aria-hidden>{t.icon}</span>
                  <small>{t.name}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const chars = twinks ? r.characters : r.characters.filter((c) => c.isMain);
              return chars.map((c, idx) => (
                <tr key={`${r.userId}:${c.id}`} className={idx > 0 ? 'twink-row' : ''}>
                  <th className="row-head" scope="row">
                    <div className="row-title">
                      <ClassIcon classKey={c.classKey} small />
                      <div className="row-text">
                        <strong>
                          {c.name}
                          {c.isMain && <span className="main-star">★</span>}
                        </strong>
                        {idx === 0 && (
                          <small>
                            {r.name} · aktiv {timeAgo(r.lastActivity, now)}
                          </small>
                        )}
                      </div>
                    </div>
                  </th>
                  {tasks.map((t) => {
                    const cells = r.cells[t.id];
                    if (!cells) return <td key={t.id} className="cell p-cell p-empty" title="nicht in der Checkliste" />;
                    const cell = t.scope === 'account' ? (idx === 0 ? cells.find((x) => x.charId === 0) : undefined) : cells.find((x) => x.charId === c.id);
                    if (!cell) return <td key={t.id} className="cell p-cell p-empty" />;
                    return (
                      <td key={t.id} className={`cell p-cell ${cellClass(t, cell.value, cell.max)}`}>
                        {cellText(t, cell.value, cell.bonus, cell.max)}
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      {data.rows.length === 0 && <p className="muted">Noch keine bestätigten Mitglieder.</p>}
    </>
  );
}

// ---------- Vorlagen ----------

function TemplatesTab() {
  const { data, error, load } = useLoad<Catalog>('/api/catalog');
  const [promote, setPromote] = useState<TemplateInfo | null>(null);
  const [addToAll, setAddToAll] = useState(false);
  const toast = useToast();
  const onError = useErrorToast();
  const now = useNow(60_000);
  if (!data) return <Loading error={error} />;

  return (
    <>
      <p className="muted">Vorlagen, die Mitglieder geteilt haben. Gute eigene Einträge daraus können in den Standard übernommen werden.</p>
      <ul className="pick-list">
        {data.templates.map((tpl) => (
          <li key={tpl.id} className="template-item">
            <span className="row-icon" aria-hidden>
              {tpl.promoted ? '⭐' : '📦'}
            </span>
            <div className="pick-main">
              <strong>{tpl.name}</strong>
              <small className="muted">
                von {tpl.author} · {timeAgo(tpl.createdAt, now)} · {tpl.uses}× übernommen
              </small>
              {tpl.description && <small className="pick-note">{tpl.description}</small>}
              <div className="template-content">
                {tpl.data.own.map((t) => (
                  <span key={t.id} className="chip chip-own">
                    {t.icon} {t.name}
                  </span>
                ))}
                {tpl.data.standard.length > 0 && <span className="chip">+ {tpl.data.standard.length} Standard-Einträge</span>}
              </div>
            </div>
            <div className="col gap">
              {tpl.data.own.length > 0 && (
                <button className="btn btn-small btn-primary" onClick={() => setPromote(tpl)}>
                  ⭐ Zum Standard
                </button>
              )}
              <button
                className="btn btn-small btn-ghost"
                onClick={async () => {
                  if (!confirm(`Vorlage „${tpl.name}“ löschen?`)) return;
                  try {
                    await del(`/api/templates/${tpl.id}`);
                    void load();
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                Löschen
              </button>
            </div>
          </li>
        ))}
        {data.templates.length === 0 && <li className="muted">Noch keine Vorlagen.</li>}
      </ul>
      {promote && (
        <Modal title={`„${promote.name}“ zum Standard machen`} onClose={() => setPromote(null)}>
          <p>
            Die {promote.data.own.length} eigenen Einträge dieser Vorlage werden als Standard-Einträge angelegt. Du kannst sie danach unter „Standard-Einträge“ anpassen.
          </p>
          <label className="inline-check">
            <input type="checkbox" checked={addToAll} onChange={(e) => setAddToAll(e.target.checked)} /> allen bisherigen Mitgliedern sofort hinzufügen
          </label>
          <div className="row gap end">
            <button className="btn btn-ghost" onClick={() => setPromote(null)}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const r = await post<{ added: number }>(`/api/admin/templates/${promote.id}/promote`, { addToAll });
                  toast({ kind: 'ok', text: `${r.added} Einträge in den Standard übernommen.` });
                  setPromote(null);
                  void load();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Übernehmen
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- Protokoll ----------

function LogTab() {
  const { data, error } = useLoad<{ entries: { id: number; at: number; kind: string; text: string }[] }>('/api/admin/log');
  const [kind, setKind] = useState('all');
  if (!data) return <Loading error={error} />;
  const kinds = [...new Set(data.entries.map((e) => e.kind))];
  const entries = data.entries.filter((e) => kind === 'all' || e.kind === kind);
  const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <>
      <div className="row gap wrap filter-bar">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Art filtern">
          <option value="all">Alle Einträge</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <ul className="log-list">
        {entries.map((e) => (
          <li key={e.id} className={e.kind === 'error' ? 'log-error' : ''}>
            <time dateTime={new Date(e.at).toISOString()}>{fmt.format(e.at)}</time>
            <span>{e.text}</span>
          </li>
        ))}
        {entries.length === 0 && <li className="muted">Noch keine Einträge.</li>}
      </ul>
    </>
  );
}
