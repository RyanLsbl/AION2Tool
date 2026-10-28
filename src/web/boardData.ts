// Laden und Ändern des Boards (Einträge, Stände) inkl. Rückgängig.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtNum } from '../shared/engine';
import type { BoardItem, TaskDef, TaskState } from '../shared/types';
import { get, post } from './api';
import { useErrorToast, useToast } from './ui';

export interface BoardResponse {
  tasks: TaskDef[];
  items: BoardItem[];
  states: TaskState[];
  now: number;
}

interface Change {
  before: TaskState | null;
  after: TaskState;
}

export type StateOp = { delta: number } | { value: number; bonus?: number };

export const stateKey = (taskId: number, charId: number) => `${taskId}:${charId}`;

export function useBoard() {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [states, setStates] = useState<Map<string, TaskState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const onError = useErrorToast();

  const load = useCallback(async () => {
    try {
      const d = await get<BoardResponse>('/api/board');
      setData(d);
      setStates(new Map(d.states.map((s) => [stateKey(s.taskId, s.charId), s])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    // Beim Zurückkehren in den Tab neu laden (z. B. Änderungen von einem anderen Gerät)
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  const tasksById = useMemo(() => new Map((data?.tasks ?? []).map((t) => [t.id, t])), [data]);

  const applyChanges = useCallback((changes: Change[]) => {
    setStates((prev) => {
      const next = new Map(prev);
      for (const c of changes) next.set(stateKey(c.after.taskId, c.after.charId), c.after);
      return next;
    });
  }, []);

  const restore = useCallback(
    async (changes: Change[]) => {
      try {
        const payload = changes.map((c) => c.before ?? { taskId: c.after.taskId, charId: c.after.charId, value: null });
        await post('/api/state/restore', { states: payload });
        setStates((prev) => {
          const next = new Map(prev);
          for (const c of changes) {
            const k = stateKey(c.after.taskId, c.after.charId);
            if (c.before) next.set(k, c.before);
            else next.delete(k);
          }
          return next;
        });
        toast({ kind: 'info', text: 'Rückgängig gemacht.' });
      } catch (e) {
        onError(e);
      }
    },
    [toast, onError],
  );

  const announce = useCallback(
    (changes: Change[], label: string) => {
      const parts = changes
        .filter((c) => tasksById.get(c.after.taskId)?.kind !== 'action' && tasksById.get(c.after.taskId)?.kind !== 'check')
        .map((c) => {
          const t = tasksById.get(c.after.taskId);
          const unit = t?.params.unit ? ` ${t.params.unit}` : '';
          const extra = c.after.bonus > 0 ? ` (+${fmtNum(c.after.bonus)} Extra)` : '';
          return `${t?.name ?? '?'}: ${fmtNum(c.after.value)}${unit}${extra}`;
        });
      toast({ kind: 'ok', text: parts.length ? `${label} → ${parts.join(' · ')}` : label, action: { label: 'Rückgängig', run: () => void restore(changes) } });
    },
    [tasksById, toast, restore],
  );

  const change = useCallback(
    async (taskId: number, charId: number, op: StateOp, label: string) => {
      try {
        const r = await post<{ changes: Change[] }>('/api/state', { taskId, charId, ...op });
        applyChanges(r.changes);
        announce(r.changes, label);
        return true;
      } catch (e) {
        onError(e);
        return false;
      }
    },
    [applyChanges, announce, onError],
  );

  const action = useCallback(
    async (taskId: number, charId: number, actionId: string, label: string) => {
      try {
        const r = await post<{ changes: Change[] }>('/api/action', { taskId, charId, actionId });
        applyChanges(r.changes);
        announce(r.changes, label);
      } catch (e) {
        onError(e);
      }
    },
    [applyChanges, announce, onError],
  );

  return { data, states, tasksById, error, load, change, action };
}
