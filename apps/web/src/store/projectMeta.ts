import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProjectMeta, ProjectPriorityDef, ProjectStatusDef } from '@rackmap/shared';
import { api } from '../lib/api';
import { toast } from './toast';

/** Swatches offered by every colour picker. Mid-tones, so the pill text mix reads on light and dark. */
export const PALETTE = [
  '#8b8d98', '#e5484d', '#f76b15', '#f0a020', '#d6b400', '#46a758', '#2fa36b', '#14a3a3',
  '#0ea5e9', '#3e83f8', '#6e56cf', '#8e4ec6', '#d6409f', '#a18072',
] as const;

interface MetaState {
  meta: ProjectMeta | null;
  loading: boolean;
  load: () => Promise<void>;
  /** Runs a meta-changing request; the server answers with the fresh meta. */
  run: (fn: () => Promise<ProjectMeta>) => Promise<boolean>;
}

export const useProjectMetaStore = create<MetaState>((set, get) => ({
  meta: null,
  loading: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try { set({ meta: await api.get<ProjectMeta>('/project-meta') }); } catch (e) { toast.error(e); } finally { set({ loading: false }); }
  },
  run: async (fn) => {
    try { set({ meta: await fn() }); return true; } catch (e) { toast.error(e); return false; }
  },
}));

const FALLBACK = '#8b8d98';

/** Lookup helpers over the loaded meta. Loads it on first use. */
export function useProjectMeta() {
  const meta = useProjectMetaStore((s) => s.meta);
  const load = useProjectMetaStore((s) => s.load);
  useEffect(() => { if (!useProjectMetaStore.getState().meta) void load(); }, [load]);
  const statuses = meta?.statuses ?? [];
  const priorities = meta?.priorities ?? [];
  const tagColors = new Map((meta?.tag_colors ?? []).map((t) => [t.name, t.color]));
  const status = (k: string): ProjectStatusDef => statuses.find((s) => s.key === k) ?? { key: k, label: k, color: FALLBACK, kind: 'todo', sort_order: 99 };
  const priority = (k: string): ProjectPriorityDef => priorities.find((p) => p.key === k) ?? { key: k, label: k, color: FALLBACK, sort_order: 99 };
  return {
    meta, statuses, priorities,
    status, priority,
    isDone: (k: string) => status(k).kind === 'done',
    tagColor: (t: string) => tagColors.get(t) ?? null,
  };
}

/** Inline style that hands a colour to .pill / .pill-dot / .swatch. */
export const cvar = (c: string | null | undefined) => (c ? ({ '--c': c } as React.CSSProperties) : undefined);
