// „Mein Setup“: Checkliste zusammenbauen (Builder).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SECTION_LABEL, type BoardItem, type Section, type TaskDef } from '../../shared/types';
import { del, get, post, put } from '../api';
import type { Session } from '../App';
import type { BoardResponse } from '../boardData';
import { Modal, Spinner, timeAgo, useErrorToast, useToast } from '../ui';
import { ruleText } from './Board';
import { draftFrom, emptyDraft, TaskForm, type TaskDraft } from './TaskForm';

export interface TemplateInfo {
  id: number;
  name: string;
  description: string;
  author: string;
  mine: boolean;
  uses: number;
  promoted: boolean;
  createdAt: number;
  data: { standard: number[]; own: { id: number; name: string; icon: string; kind: string }[] };
}

export interface Catalog {
  standard: TaskDef[];
  templates: TemplateInfo[];
}

export function Builder({ session }: { session: Session }) {
  const { me } = session;
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'add' | 'share' | { edit: TaskDef }>(null);
  const toast = useToast();
  const onError = useErrorToast();

  const load = useCallback(async () => {
    try {
      setBoard(await get<BoardResponse>('/api/board'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const tasksById = useMemo(() => new Map((board?.tasks ?? []).map((t) => [t.id, t])), [board]);
  const items = useMemo(() => (board?.items ?? []).filter((i) => tasksById.has(i.taskId)).sort((a, b) => a.sort - b.sort), [board, tasksById]);

  if (error) return <p className="alert alert-danger">{error}</p>;
  if (!board) return <div className="center-block"><Spinner /></div>;

  /** Speichert Reihenfolge/Einstellungen (optimistisch). */
  const saveItems = async (next: BoardItem[]) => {
    const sorted = next.map((i, idx) => ({ ...i, sort: idx }));
    setBoard((b) => (b ? { ...b, items: sorted } : b));
    try {
      await put('/api/board/items', { items: sorted });
    } catch (e) {
      onError(e);
      void load();
    }
  };

  const bySection = (section: Section) => items.filter((i) => tasksById.get(i.taskId)!.section === section);
  const ordered = () => [...bySection('daily'), ...bySection('weekly')];

  const move = (taskId: number, dir: -1 | 1) => {
    const t = tasksById.get(taskId)!;
    const list = bySection(t.section);
    const idx = list.findIndex((i) => i.taskId === taskId);
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    const other = t.section === 'daily' ? bySection('weekly') : bySection('daily');
    void saveItems(t.section === 'daily' ? [...list, ...other] : [...other, ...list]);
  };

  const patch = (taskId: number, p: Partial<BoardItem>) => void saveItems(ordered().map((i) => (i.taskId === taskId ? { ...i, ...p } : i)));

  const remove = async (t: TaskDef) => {
    const own = t.ownerId !== null;
    if (!confirm(own ? `Eigenen Eintrag „${t.name}“ endgültig löschen? Gespeicherte Stände gehen verloren.` : `„${t.name}“ aus deiner Checkliste entfernen? Du kannst ihn jederzeit wieder hinzufügen.`)) return;
    try {
      await (own ? del(`/api/tasks/${t.id}`) : del(`/api/board/items/${t.id}`));
      toast({ kind: 'ok', text: own ? `„${t.name}“ gelöscht.` : `„${t.name}“ entfernt.` });
      void load();
    } catch (e) {
      onError(e);
    }
  };

  const ownTargets = board.tasks;

  return (
    <div className="builder-page">
      <div className="page-head">
        <div>
          <h1>Mein Setup</h1>
          <p className="muted">Bau dir deine Checkliste: Reihenfolge, Sichtbarkeit, Charaktere und eigene Einträge.</p>
        </div>
        <div className="row gap wrap">
          <button className="btn" onClick={() => setDialog('share')}>
            📤 Als Vorlage teilen
          </button>
          <button className="btn btn-primary" onClick={() => setDialog('add')}>
            ＋ Inhalt hinzufügen
          </button>
        </div>
      </div>

      {(['daily', 'weekly'] as Section[]).map((section) => {
        const list = bySection(section);
        return (
          <section key={section} className="card builder-section">
            <h2>{SECTION_LABEL[section]}</h2>
            {list.length === 0 && <p className="muted">Noch nichts – über „Inhalt hinzufügen“ ergänzen.</p>}
            <ul className="builder-list">
              {list.map((item, idx) => {
                const t = tasksById.get(item.taskId)!;
                return (
                  <li key={item.taskId} className={`builder-item ${item.hidden ? 'is-hidden' : ''}`}>
                    <div className="builder-move">
                      <button className="icon-btn" onClick={() => move(item.taskId, -1)} disabled={idx === 0} aria-label={`${t.name} nach oben`}>
                        ▲
                      </button>
                      <button className="icon-btn" onClick={() => move(item.taskId, 1)} disabled={idx === list.length - 1} aria-label={`${t.name} nach unten`}>
                        ▼
                      </button>
                    </div>
                    <span className="row-icon" aria-hidden>
                      {t.icon}
                    </span>
                    <div className="builder-main">
                      <strong>{t.name}</strong>
                      <small className="muted">
                        {ruleText(t, me.abo)}
                        {t.scope === 'account' && <span className="tag">server-weit</span>}
                        <span className={`tag ${t.ownerId === null ? 'tag-std' : 'tag-own'}`}>{t.ownerId === null ? 'Standard' : 'eigener'}</span>
                      </small>
                      {t.scope === 'character' && me.characters.length > 1 && (
                        <div className="char-chips" role="group" aria-label={`${t.name}: Charaktere`}>
                          {me.characters.map((c) => {
                            const on = !item.offChars.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                className={`chip ${on ? 'on' : ''}`}
                                aria-pressed={on}
                                onClick={() => patch(item.taskId, { offChars: on ? [...item.offChars, c.id] : item.offChars.filter((x) => x !== c.id) })}
                                title={on ? `Bei ${c.name} ausblenden` : `Bei ${c.name} anzeigen`}
                              >
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="builder-actions">
                      <button
                        className={`toggle ${item.hidden ? '' : 'on'}`}
                        onClick={() => patch(item.taskId, { hidden: !item.hidden })}
                        aria-pressed={!item.hidden}
                        title={item.hidden ? 'Wieder in der Checkliste anzeigen' : 'In der Checkliste ausblenden (Stände bleiben)'}
                      >
                        {item.hidden ? '🙈 aus' : '👁️ an'}
                      </button>
                      {t.kind !== 'action' && (
                        <button
                          className={`toggle ${item.muted ? '' : 'on'}`}
                          onClick={() => patch(item.taskId, { muted: !item.muted })}
                          aria-pressed={!item.muted}
                          title={item.muted ? 'Warnungen wieder anzeigen' : 'Warnungen für diesen Eintrag stummschalten'}
                        >
                          {item.muted ? '🔕' : '🔔'}
                        </button>
                      )}
                      {t.ownerId !== null && (
                        <button className="icon-btn" onClick={() => setDialog({ edit: t })} aria-label={`${t.name} bearbeiten`} title="Bearbeiten">
                          ✏️
                        </button>
                      )}
                      <button className="icon-btn danger" onClick={() => void remove(t)} aria-label={`${t.name} entfernen`} title={t.ownerId !== null ? 'Löschen' : 'Entfernen'}>
                        🗑️
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {dialog === 'add' && (
        <AddDialog
          session={session}
          onBoard={new Set(items.map((i) => i.taskId))}
          targets={ownTargets}
          onClose={() => setDialog(null)}
          onChanged={() => void load()}
        />
      )}
      {dialog === 'share' && <ShareDialog items={items} tasksById={tasksById} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && (
        <Modal title={`„${dialog.edit.name}“ bearbeiten`} onClose={() => setDialog(null)} wide>
          <TaskForm
            initial={draftFrom(dialog.edit)}
            targets={ownTargets.filter((t) => t.id !== dialog.edit.id)}
            submitLabel="Speichern"
            onCancel={() => setDialog(null)}
            onSubmit={async (d) => {
              try {
                await put(`/api/tasks/${dialog.edit.id}`, d);
                toast({ kind: 'ok', text: `„${d.name}“ gespeichert.` });
                setDialog(null);
                void load();
              } catch (e) {
                onError(e);
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AddDialog({
  session, onBoard, targets, onClose, onChanged,
}: {
  session: Session;
  onBoard: Set<number>;
  targets: TaskDef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'standard' | 'templates' | 'own'>('standard');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const toast = useToast();
  const onError = useErrorToast();

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await get<Catalog>('/api/catalog'));
    } catch (e) {
      onError(e);
    }
  }, [onError]);
  useEffect(() => void loadCatalog(), [loadCatalog]);

  const addStandard = async (t: TaskDef) => {
    try {
      await post('/api/board/items', { taskId: t.id });
      setAdded((s) => new Set(s).add(t.id));
      toast({ kind: 'ok', text: `„${t.name}“ hinzugefügt.` });
      onChanged();
    } catch (e) {
      onError(e);
    }
  };

  const importTemplate = async (tpl: TemplateInfo) => {
    try {
      const r = await post<{ added: number }>(`/api/templates/${tpl.id}/import`);
      toast({ kind: 'ok', text: r.added ? `Vorlage „${tpl.name}“ übernommen (${r.added} Einträge).` : 'Alles aus dieser Vorlage hast du schon.' });
      onChanged();
      void loadCatalog();
    } catch (e) {
      onError(e);
    }
  };

  const deleteTemplate = async (tpl: TemplateInfo) => {
    if (!confirm(`Vorlage „${tpl.name}“ löschen?`)) return;
    try {
      await del(`/api/templates/${tpl.id}`);
      void loadCatalog();
    } catch (e) {
      onError(e);
    }
  };

  const standardById = new Map((catalog?.standard ?? []).map((t) => [t.id, t]));

  return (
    <Modal title="Inhalt hinzufügen" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'standard'} className={tab === 'standard' ? 'active' : ''} onClick={() => setTab('standard')}>
          Standard der Legion
        </button>
        <button role="tab" aria-selected={tab === 'templates'} className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
          Vorlagen der Mitglieder
        </button>
        <button role="tab" aria-selected={tab === 'own'} className={tab === 'own' ? 'active' : ''} onClick={() => setTab('own')}>
          Eigener Eintrag
        </button>
      </div>

      {tab !== 'own' && !catalog && (
        <div className="center-block">
          <Spinner />
        </div>
      )}

      {tab === 'standard' && catalog && (
        <ul className="pick-list">
          {catalog.standard.map((t) => {
            const has = onBoard.has(t.id) || added.has(t.id);
            return (
              <li key={t.id}>
                <span className="row-icon" aria-hidden>
                  {t.icon}
                </span>
                <div className="pick-main">
                  <strong>{t.name}</strong>
                  <small className="muted">
                    {SECTION_LABEL[t.section]} · {ruleText(t, session.me.abo)}
                    {t.scope === 'account' && ' · server-weit'}
                  </small>
                  {t.note && <small className="pick-note">{t.note}</small>}
                </div>
                <button className="btn btn-small" disabled={has} onClick={() => void addStandard(t)}>
                  {has ? '✓ drin' : 'Hinzufügen'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'templates' && catalog && (
        <>
          {catalog.templates.length === 0 && <p className="muted">Noch keine Vorlagen. Teile dein Setup über „Als Vorlage teilen“!</p>}
          <ul className="pick-list">
            {catalog.templates.map((tpl) => (
              <li key={tpl.id} className="template-item">
                <span className="row-icon" aria-hidden>
                  {tpl.promoted ? '⭐' : '📦'}
                </span>
                <div className="pick-main">
                  <strong>{tpl.name}</strong>
                  <small className="muted">
                    von {tpl.author} · {timeAgo(tpl.createdAt)} · {tpl.uses}× übernommen{tpl.promoted && ' · im Standard'}
                  </small>
                  {tpl.description && <small className="pick-note">{tpl.description}</small>}
                  <div className="template-content">
                    {tpl.data.standard.map((id) => standardById.get(id)).filter(Boolean).map((t) => (
                      <span key={`s${t!.id}`} className="chip">
                        {t!.icon} {t!.name}
                      </span>
                    ))}
                    {tpl.data.own.map((t) => (
                      <span key={`o${t.id}`} className="chip chip-own">
                        {t.icon} {t.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="col gap">
                  <button className="btn btn-small btn-primary" onClick={() => void importTemplate(tpl)}>
                    Übernehmen
                  </button>
                  {(tpl.mine || session.me.isOfficer) && (
                    <button className="btn btn-small btn-ghost" onClick={() => void deleteTemplate(tpl)}>
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'own' && (
        <TaskForm
          initial={emptyDraft()}
          targets={targets}
          submitLabel="Eintrag anlegen"
          onCancel={onClose}
          onSubmit={async (d: TaskDraft) => {
            try {
              await post('/api/tasks', d);
              toast({ kind: 'ok', text: `„${d.name}“ angelegt und zu deiner Checkliste hinzugefügt.` });
              onChanged();
              onClose();
            } catch (e) {
              onError(e);
            }
          }}
        />
      )}
    </Modal>
  );
}

function ShareDialog({ items, tasksById, onClose }: { items: BoardItem[]; tasksById: Map<number, TaskDef>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(items.filter((i) => tasksById.get(i.taskId)?.ownerId !== null).map((i) => i.taskId)));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const onError = useErrorToast();

  const submit = async () => {
    setBusy(true);
    try {
      await post('/api/templates', { name, description, taskIds: [...picked] });
      toast({ kind: 'ok', text: `Vorlage „${name}“ veröffentlicht – alle Mitglieder können sie jetzt übernehmen.` });
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Als Vorlage teilen" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Name der Vorlage</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="z. B. Raid-Woche Ludra" autoFocus />
        </label>
        <label className="field">
          <span>
            Beschreibung <em>(optional)</em>
          </span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} />
        </label>
        <fieldset className="field">
          <legend>Enthaltene Einträge</legend>
          <ul className="check-list">
            {items.map((i) => {
              const t = tasksById.get(i.taskId)!;
              return (
                <li key={i.taskId}>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={picked.has(i.taskId)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(i.taskId);
                          else n.delete(i.taskId);
                          return n;
                        })
                      }
                    />
                    {t.icon} {t.name} <small className="muted">({t.ownerId === null ? 'Standard' : 'eigener'})</small>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <div className="row gap end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim() || picked.size === 0}>
            Veröffentlichen
          </button>
        </div>
      </form>
    </Modal>
  );
}
