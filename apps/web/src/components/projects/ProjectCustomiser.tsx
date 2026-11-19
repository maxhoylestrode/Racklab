import { useMemo, useState } from 'react';
import { PROJECT_META_LABEL_MAX, type Project, type ProjectMeta, type ProjectStatusKind } from '@rackmap/shared';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/useFetch';
import { PALETTE, cvar, useProjectMeta, useProjectMetaStore } from '../../store/projectMeta';
import { Icon } from '../Icon';
import { ColorPicker, PillSelect, TagChip } from './controls';

export const KIND_OPTIONS: { value: ProjectStatusKind; label: string; hint: string }[] = [
  { value: 'todo', label: 'To do', hint: 'not started' },
  { value: 'active', label: 'Active', hint: 'being worked on' },
  { value: 'done', label: 'Done', hint: 'completes projects' },
];

type Tab = 'statuses' | 'priorities' | 'tags';
interface Row { key: string; label: string; color: string; kind?: ProjectStatusKind }

/** Edit board columns, priority levels and tag colours. `onChanged` runs after anything that can move projects. */
export function ProjectCustomiser({ onChanged, initialTab = 'statuses' }: { onChanged?: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const { statuses, priorities, tagColor } = useProjectMeta();
  const run = useProjectMetaStore((s) => s.run);
  const all = useFetch<Project[]>('/projects?include_archived=true');
  const projects = useMemo(() => all.data ?? [], [all.data]);
  const tags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags))].sort(), [projects]);
  const count = (field: 'status' | 'priority', key: string) => projects.filter((p) => p[field] === key).length;
  const after = async (ok: boolean, moved = false) => { if (ok && moved) { await all.reload(); onChanged?.(); } };

  const base = tab === 'statuses' ? '/project-meta/statuses' : '/project-meta/priorities';
  const rows: Row[] = tab === 'statuses' ? statuses : priorities;
  const field = tab === 'statuses' ? 'status' : 'priority';
  const move = (i: number, d: number) => {
    const keys = rows.map((r) => r.key);
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    void run(() => api.put<ProjectMeta>(`${base}/order`, { keys })).then((ok) => after(ok, true));
  };

  return (
    <div>
      <div className="segmented mb-4" role="tablist" aria-label="Customise">
        {(['statuses', 'priorities', 'tags'] as Tab[]).map((t) => (
          <button key={t} role="tab" className="btn" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'statuses' ? 'Statuses' : t === 'priorities' ? 'Priorities' : 'Tag colours'}
          </button>
        ))}
      </div>

      {tab !== 'tags' ? (
        <>
          <p className="mb-3 text-sm text-ink-2">
            {tab === 'statuses'
              ? 'Statuses are your board columns, in this order. A Done status marks its projects complete and hides them from open counts.'
              : 'Order from most to least urgent. New projects start at the middle level.'}
          </p>
          <ul className="space-y-1" aria-label={tab === 'statuses' ? 'Statuses' : 'Priorities'}>
            {rows.map((r, i) => (
              <MetaRow key={r.key} row={r} index={i} total={rows.length} used={count(field, r.key)} kindEditable={tab === 'statuses'}
                others={rows.filter((x) => x.key !== r.key)}
                onMove={(d) => move(i, d)}
                onPatch={(body) => void run(() => api.patch<ProjectMeta>(`${base}/${r.key}`, body)).then((ok) => after(ok, 'kind' in body))}
                onDelete={async (to) => after(await run(() => api.del<ProjectMeta>(`${base}/${r.key}${to ? `?reassign_to=${encodeURIComponent(to)}` : ''}`)), true)} />
            ))}
          </ul>
          <AddRow kindEditable={tab === 'statuses'} label={tab === 'statuses' ? 'status' : 'priority'} key={tab}
            onAdd={(body) => run(() => api.post<ProjectMeta>(base, body))} />
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">Give tags a colour to show them as coloured chips on cards and in the list. Tags without one stay plain.</p>
          {tags.length === 0 ? <p className="text-sm text-ink-2">No tags yet. Add tags to a project and they appear here.</p> : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {tags.map((t) => (
                <li key={t} className="-mx-2 flex h-9 items-center gap-3 rounded-control px-2 hover:bg-surface-hover">
                  <ColorPicker size="sm" allowNone label={`Colour for #${t}`} value={tagColor(t)}
                    onChange={(c) => void run(() => c ? api.put<ProjectMeta>(`/project-meta/tags/${encodeURIComponent(t)}`, { color: c }) : api.del<ProjectMeta>(`/project-meta/tags/${encodeURIComponent(t)}`))} />
                  <TagChip tag={t} color={tagColor(t)} />
                  <span className="ml-auto font-mono text-xs text-ink-2">{projects.filter((p) => p.tags.includes(t)).length}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function MetaRow({ row, index, total, used, kindEditable, others, onMove, onPatch, onDelete }: {
  row: Row; index: number; total: number; used: number; kindEditable: boolean; others: Row[];
  onMove: (d: number) => void; onPatch: (b: Partial<Row>) => void; onDelete: (reassignTo?: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(row.label);
  const [deleting, setDeleting] = useState(false);
  const [to, setTo] = useState(others[0]?.key ?? '');
  const commit = () => { const v = label.trim(); if (v && v !== row.label) onPatch({ label: v }); else setLabel(row.label); };
  return (
    <li className="rounded-control">
      <div className="group -mx-2 flex min-h-10 flex-wrap items-center gap-2 rounded-control px-2 py-1 hover:bg-surface-hover">
        <span className="flex flex-col">
          <button type="button" className="btn btn-ghost btn-icon h-4 w-5 min-h-0 p-0 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${row.label} up`} onClick={() => onMove(-1)}><Icon name="chevronUp" size={12} /></button>
          <button type="button" className="btn btn-ghost btn-icon h-4 w-5 min-h-0 p-0 disabled:opacity-30" disabled={index === total - 1} aria-label={`Move ${row.label} down`} onClick={() => onMove(1)}><Icon name="chevronDown" size={12} /></button>
        </span>
        <ColorPicker label={`Colour for ${row.label}`} value={row.color} onChange={(c) => c && onPatch({ color: c })} />
        <input className="input h-8 min-w-[120px] flex-1" value={label} maxLength={PROJECT_META_LABEL_MAX} aria-label="Name"
          onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {kindEditable && (
          <PillSelect variant="field" size="sm" className="w-[112px]" label={`Kind of ${row.label}`} value={row.kind ?? 'todo'}
            options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label, hint: k.hint }))} onChange={(v) => onPatch({ kind: v as ProjectStatusKind })} />
        )}
        <span className="w-[72px] text-right text-xs text-ink-2">{used} project{used === 1 ? '' : 's'}</span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon text-ink-2 hover:text-bad disabled:opacity-30" disabled={total <= 1}
          aria-label={`Delete ${row.label}`} title={total <= 1 ? 'Keep at least one' : 'Delete'} onClick={() => (used ? setDeleting(true) : void onDelete())}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      {deleting && (
        <div className="mb-2 ml-6 flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface-inset p-2 text-sm" role="group" aria-label={`Delete ${row.label}`}>
          <span className="text-ink-2">Move its {used} project{used === 1 ? '' : 's'} to</span>
          <PillSelect label="Move projects to" value={to} options={others.map((o) => ({ value: o.key, label: o.label, color: o.color }))} onChange={setTo} />
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setDeleting(false)}>Cancel</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={async () => { await onDelete(to); setDeleting(false); }}>Move and delete</button>
          </span>
        </div>
      )}
    </li>
  );
}

function AddRow({ kindEditable, label, onAdd }: { kindEditable: boolean; label: string; onAdd: (b: Omit<Row, 'key'>) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PALETTE[9]);
  const [kind, setKind] = useState<ProjectStatusKind>('active');
  return (
    <form className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3" onSubmit={async (e) => {
      e.preventDefault();
      const v = name.trim();
      if (!v) return;
      if (await onAdd({ label: v, color, ...(kindEditable ? { kind } : {}) })) setName('');
    }}>
      <span className="w-5" aria-hidden />
      <ColorPicker label={`Colour for new ${label}`} value={color} onChange={(c) => c && setColor(c)} />
      <input className="input h-8 min-w-[120px] flex-1" placeholder={`New ${label}, e.g. ${kindEditable ? 'Blocked' : 'Urgent'}`} value={name}
        maxLength={PROJECT_META_LABEL_MAX} onChange={(e) => setName(e.target.value)} aria-label={`New ${label} name`} />
      {kindEditable && (
        <PillSelect variant="field" size="sm" className="w-[112px]" label="Kind" value={kind}
          options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label, hint: k.hint }))} onChange={(v) => setKind(v as ProjectStatusKind)} />
      )}
      <button className="btn btn-sm" disabled={!name.trim()}><Icon name="plus" size={12} />Add</button>
      {name.trim() && <span className="pill w-full sm:w-auto" style={cvar(color)}><span className="pill-dot" />{name.trim()}</span>}
    </form>
  );
}
