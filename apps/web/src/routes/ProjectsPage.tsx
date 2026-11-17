import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROJECT_PRIORITIES, PROJECT_STATUSES, type Project, type ProjectPriority, type ProjectStatus } from '@rackmap/shared';
import { useFetch } from '../lib/useFetch';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import { useUi } from '../store/ui';
import { useLab } from '../store/lab';
import { NewProjectDialog } from '../components/projects/NewProjectDialog';
import { ProjectDrawer, STATUS_LABEL } from '../components/projects/ProjectDrawer';
import { Empty } from '../components/ui';
import { PageHeader, SummaryCard } from '../components/primitives';
import { usePrimaryAction } from '../store/chrome';
import { Icon } from '../components/Icon';

const PRIORITY_RANK: Record<ProjectPriority, number> = { high: 0, medium: 1, low: 2 };
const STATUS_RANK: Record<ProjectStatus, number> = { in_progress: 0, not_started: 1, complete: 2 };
// Colour only where it carries signal: high is red, the rest stay neutral.
const PRIORITY_CHIP: Record<ProjectPriority, string> = { high: 'chip-bad', medium: '', low: '' };
const STATUS_DOT: Record<ProjectStatus, string> = { not_started: 'bg-unknown', in_progress: 'bg-accent', complete: 'bg-ok' };

function projectCaption(ps: Project[]): string {
  const late = ps.filter(overdue).length;
  const done = ps.reduce((n, p) => n + p.task_progress.done, 0), total = ps.reduce((n, p) => n + p.task_progress.total, 0);
  return [late ? `${late} overdue.` : 'Nothing overdue.', total ? `${done} of ${total} checklist steps done.` : ''].filter(Boolean).join(' ');
}
const today = () => new Date().toISOString().slice(0, 10);
const overdue = (p: Project) => !!p.due_date && p.status !== 'complete' && p.due_date < today();
const linkLabel = (p: Project) => p.links.map((l) => l.device_name ?? l.service_name).filter(Boolean) as string[];

export default function ProjectsPage() {
  const { data, setData, reload } = useFetch<Project[]>('/projects');
  const { projectsView, setProjectsView } = useUi();
  const { loaded, load, refreshBadges } = useLab();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (!loaded) void load().catch(toast.error); }, [loaded, load]);
  const projects = data ?? [];
  usePrimaryAction('New project', useCallback(() => setCreating(true), []));

  const changed = (p: Project | null, id?: string) => {
    setData((xs) => {
      if (!xs) return xs;
      if (!p) return xs.filter((x) => x.id !== id);
      if (p.archived) return xs.filter((x) => x.id !== p.id);
      return xs.some((x) => x.id === p.id) ? xs.map((x) => (x.id === p.id ? p : x)) : [...xs, p];
    });
    void refreshBadges();
  };

  const move = async (id: string, status: ProjectStatus, index: number) => {
    // Optimistic reorder, then sync with the server's renumbering.
    setData((xs) => {
      if (!xs) return xs;
      const moving = xs.find((x) => x.id === id);
      if (!moving) return xs;
      const rest = xs.filter((x) => x.id !== id);
      const col = rest.filter((x) => x.status === status).sort((a, b) => a.sort_order - b.sort_order);
      col.splice(Math.min(index, col.length), 0, { ...moving, status });
      const renum = new Map(col.map((x, i) => [x.id, i]));
      return [...rest.filter((x) => x.status !== status), ...col].map((x) => (renum.has(x.id) ? { ...x, sort_order: renum.get(x.id)! } : x));
    });
    try {
      await api.post(`/projects/${id}/move`, { status, sort_order: index });
      await reload();
      void refreshBadges();
    } catch (e) { toast.error(e); void reload(); }
  };

  return (
    <div className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <PageHeader title="Projects" description="Planned homelab work, linked to the devices and services it touches."
          actions={<div className="segmented no-print" role="group" aria-label="Projects view">
            <button className="btn" aria-pressed={projectsView === 'board'} onClick={() => setProjectsView('board')}><Icon name="board" /> Board</button>
            <button className="btn" aria-pressed={projectsView === 'list'} onClick={() => setProjectsView('list')}><Icon name="list" /> List</button>
          </div>} />
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          {data && <div className="max-lg:hidden"><SummaryCard label="Open projects" value={projects.filter((p) => p.status !== 'complete').length} of={projects.length}
            caption={projectCaption(projects)}
            bars={PROJECT_STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: projects.filter((p) => p.status === s).length }))} /></div>}
        <div className="min-w-0">
          {data && projects.length === 0 ? (
            <Empty title="No projects yet" action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>}>
              Plan homelab work here, such as “Add a second NIC to the R420” or “Build a CT for Jellyfin”. Link projects to devices and services, or keep them standalone.
            </Empty>
          ) : projectsView === 'board'
            ? <Board projects={projects} onOpen={setOpen} onMove={move} onQuickAdd={async (status, title) => {
              try { const p = await api.post<Project>('/projects', { title, status }); changed(p); } catch (e) { toast.error(e); }
            }} />
            : <ListView projects={projects} onOpen={setOpen} onStatus={async (p, status) => {
              try { changed(await api.patch<Project>(`/projects/${p.id}`, { status })); } catch (e) { toast.error(e); }
            }} />}
        </div>
        </div>
      </div>
      {open && <ProjectDrawer key={open} projectId={open} onClose={() => setOpen(null)} onChanged={(p) => changed(p, open)} />}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={(p) => changed(p)} />}
    </div>
  );
}

// ---------------- Kanban ----------------
function Board({ projects, onOpen, onMove, onQuickAdd }: {
  projects: Project[]; onOpen: (id: string) => void; onMove: (id: string, s: ProjectStatus, i: number) => Promise<void>; onQuickAdd: (s: ProjectStatus, title: string) => Promise<void>;
}) {
  const [completeOpen, setCompleteOpen] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ status: ProjectStatus; index: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const cols = useMemo(() => Object.fromEntries(PROJECT_STATUSES.map((s) => [s, projects.filter((p) => p.status === s).sort((a, b) => a.sort_order - b.sort_order)])) as Record<ProjectStatus, Project[]>, [projects]);

  const finishDrop = async (status: ProjectStatus, index: number) => {
    const id = drag;
    setDrag(null); setDrop(null);
    if (!id) return;
    const cur = projects.find((p) => p.id === id);
    if (!cur) return;
    // Dropping below itself in the same column: account for its own removal.
    const curIdx = cols[status].findIndex((p) => p.id === id);
    const target = cur.status === status && curIdx >= 0 && curIdx < index ? index - 1 : index;
    if (cur.status === status && curIdx === target) return;
    await onMove(id, status, target);
  };

  return (
    <div className={`grid gap-4 ${completeOpen ? 'md:grid-cols-3' : 'md:grid-cols-[repeat(2,minmax(0,1fr))_minmax(180px,0.45fr)]'}`}>
      <p id="card-kbd-hint" className="sr-only">Enter opens the project. M opens the status menu. Alt plus Up or Down reorders within the column.</p>
      {PROJECT_STATUSES.map((status) => {
        const list = cols[status];
        const collapsed = status === 'complete' && !completeOpen;
        return (
          <section key={status} aria-label={`${STATUS_LABEL[status]} column`}
            className={`flex min-h-[200px] flex-col rounded-panel p-1 ${drop?.status === status ? 'outline-dashed outline-1 outline-offset-2 outline-accent' : ''}`}
            onDragOver={(e) => { if (drag) { e.preventDefault(); if (drop?.status !== status || list.length === 0) setDrop({ status, index: list.length }); } }}
            onDrop={(e) => { e.preventDefault(); void finishDrop(status, drop?.status === status ? drop.index : list.length); }}>
            <header className="mb-2 flex h-8 items-center gap-2 px-2">
              {status === 'complete' && (
                <button className="btn btn-ghost btn-sm btn-icon -ml-2" aria-expanded={completeOpen} aria-label={completeOpen ? 'Collapse Complete' : 'Expand Complete'} onClick={() => setCompleteOpen((o) => !o)}>
                  <Icon name={completeOpen ? 'chevronDown' : 'chevronRight'} size={13} />
                </button>
              )}
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
              <h2 className="text-sm font-medium text-ink">{STATUS_LABEL[status]}</h2>
              <span className="font-mono text-xs text-ink-2">{list.length}</span>
            </header>
            {!collapsed && <QuickAdd onAdd={(t) => onQuickAdd(status, t)} label={STATUS_LABEL[status]} />}
            {collapsed ? (
              <p className="px-2 text-sm text-ink-2">{list.length} done. Expand to see them, or drop a card here to complete it.</p>
            ) : (
              <ol className="flex flex-1 flex-col gap-2">
                {list.map((p, i) => (
                  <li key={p.id}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault(); e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setDrop({ status, index: e.clientY < r.top + r.height / 2 ? i : i + 1 });
                    }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void finishDrop(status, drop?.status === status ? drop.index : i); }}>
                    {drop?.status === status && drop.index === i && drag !== p.id && <div className="mb-2 h-0.5 rounded-full bg-accent" />}
                    <Card p={p} dragging={drag === p.id} onOpen={() => onOpen(p.id)}
                      onDragStart={() => setDrag(p.id)} onDragEnd={() => { setDrag(null); setDrop(null); }}
                      menuOpen={menu === p.id} setMenu={(o) => setMenu(o ? p.id : null)}
                      onStatus={(s) => void onMove(p.id, s, cols[s].length)}
                      onShift={(d) => { const j = i + d; if (j >= 0 && j < list.length) void onMove(p.id, status, j); }} />
                    {drop?.status === status && drop.index === list.length && i === list.length - 1 && <div className="mt-2 h-0.5 rounded-full bg-accent" />}
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function QuickAdd({ onAdd, label }: { onAdd: (title: string) => Promise<void>; label: string }) {
  const [v, setV] = useState('');
  return (
    <form className="mb-2" onSubmit={async (e) => { e.preventDefault(); const t = v.trim(); if (!t) return; setV(''); await onAdd(t); }}>
      <input className="input h-8 border-transparent bg-transparent text-sm placeholder:text-ink-2 hover:bg-surface-hover focus:bg-surface-field" placeholder="Add a project, press Enter" value={v} maxLength={200} onChange={(e) => setV(e.target.value)} aria-label={`Quick add to ${label}`} />
    </form>
  );
}

function Card({ p, dragging, onOpen, onDragStart, onDragEnd, menuOpen, setMenu, onStatus, onShift }: {
  p: Project; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void;
  menuOpen: boolean; setMenu: (o: boolean) => void; onStatus: (s: ProjectStatus) => void; onShift: (d: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const links = linkLabel(p);
  return (
    <div ref={ref} draggable onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id);
        // Lift for the drag snapshot (scale 1.02 and a deeper shadow), then settle into the placeholder state.
        const el = e.currentTarget;
        el.classList.add('is-lifting');
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-lifting')));
        onDragStart();
      }} onDragEnd={onDragEnd}
      tabIndex={0} role="button" aria-describedby="card-kbd-hint"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        else if (e.key.toLowerCase() === 'm') { e.preventDefault(); setMenu(true); }
        else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); onShift(-1); }
        else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); onShift(1); }
      }}
      className={`kanban-card panel group relative cursor-pointer rounded-panel p-3 hover:border-line-strong ${dragging ? 'border-dashed !shadow-none opacity-40' : ''}`}>
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-sm font-medium ${p.status === 'complete' ? 'text-ink-2 line-through' : 'text-ink'}`}>{p.title}</p>
        <button className="btn btn-ghost btn-sm btn-icon -mr-1 -mt-1 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Change status of ${p.title}`}
          onClick={(e) => { e.stopPropagation(); setMenu(!menuOpen); }}><Icon name="more" /></button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <span className={`chip ${PRIORITY_CHIP[p.priority]}`}>{p.priority}</span>
        {p.due_date && <span className={`chip tabular ${overdue(p) ? 'chip-bad' : ''}`}>{overdue(p) ? 'Overdue ' : 'Due '}{p.due_date}</span>}
        {links.map((l) => <span key={l} className="chip max-w-full"><span className="truncate">{l}</span></span>)}
      </div>
      {p.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{p.tags.map((t) => <span key={t} className="text-xs text-ink-2">#{t}</span>)}</div>}
      {p.task_progress.total > 0 && (
        <div className="mt-2 flex items-center gap-2" aria-label={`${p.task_progress.done} of ${p.task_progress.total} steps done`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-track"><div className="h-full rounded-full bg-accent" style={{ width: `${(p.task_progress.done / p.task_progress.total) * 100}%` }} /></div>
          <span className="font-mono text-xs text-ink-2">{p.task_progress.done}/{p.task_progress.total}</span>
        </div>
      )}
      {menuOpen && (
        <div role="menu" className="menu absolute right-2 top-10 w-44" onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') { setMenu(false); ref.current?.focus(); } }}>
          {PROJECT_STATUSES.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={p.status === s} autoFocus={p.status === s}
              className="menu-item"
              onClick={() => { setMenu(false); if (s !== p.status) onStatus(s); ref.current?.focus(); }}>
              <span className="flex w-4 justify-center text-accent">{p.status === s && <Icon name="check" />}</span>{STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- List ----------------
type SortKey = 'default' | 'title' | 'status' | 'priority' | 'due' | 'updated';

function ListView({ projects, onOpen, onStatus }: { projects: Project[]; onOpen: (id: string) => void; onStatus: (p: Project, s: ProjectStatus) => Promise<void> }) {
  const { devices } = useLab();
  const [status, setStatus] = useState<'' | ProjectStatus>('');
  const [priority, setPriority] = useState<'' | ProjectPriority>('');
  const [linked, setLinked] = useState<'' | 'linked' | 'unlinked'>('');
  const [device, setDevice] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'default', dir: 1 });
  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags))].sort(), [projects]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = projects.filter((p) =>
      (!status || p.status === status) && (!priority || p.priority === priority)
      && (!linked || (linked === 'linked' ? p.links.length > 0 : p.links.length === 0))
      && (!device || p.links.some((l) => l.device_id === device || l.service_device_id === device))
      && (!tag || p.tags.includes(tag))
      && (!needle || `${p.title} ${p.description_markdown} ${p.tags.join(' ')} ${linkLabel(p).join(' ')}`.toLowerCase().includes(needle)));
    const byDefault = (a: Project, b: Project) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title);
    const cmp: Record<SortKey, (a: Project, b: Project) => number> = {
      default: byDefault,
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      due: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    };
    return [...filtered].sort((a, b) => cmp[sort.key](a, b) * sort.dir || byDefault(a, b));
  }, [projects, status, priority, linked, device, tag, q, sort]);

  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 uppercase tracking-label hover:text-ink" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {children}{sort.key === k && <Icon name={sort.dir === 1 ? 'chevronUp' : 'chevronDown'} className="text-accent" />}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1"><span className="label">Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, description, tag" /></label>
        <label><span className="label">Status</span><select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | '')}><option value="">Any</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label><span className="label">Priority</span><select className="input" value={priority} onChange={(e) => setPriority(e.target.value as ProjectPriority | '')}><option value="">Any</option>{PROJECT_PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label><span className="label">Links</span><select className="input" value={linked} onChange={(e) => setLinked(e.target.value as '' | 'linked' | 'unlinked')}><option value="">All</option><option value="linked">Linked</option><option value="unlinked">Unlinked</option></select></label>
        <label><span className="label">Device</span><select className="input" value={device} onChange={(e) => setDevice(e.target.value)}><option value="">Any</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label><span className="label">Tag</span><select className="input" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">Any</option>{allTags.map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>
      <div className="panel overflow-x-auto rounded-panel">
        <table className="table-base">
          <thead><tr><Th k="title">Title</Th><Th k="status">Status</Th><Th k="priority">Priority</Th><th>Linked to</th><Th k="due">Due</Th><th>Tags</th><Th k="updated">Updated</Th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><button className="text-left text-ink hover:text-accent" onClick={() => onOpen(p.id)}>{p.title}</button>
                  {p.task_progress.total > 0 && <span className="ml-2 font-mono text-xs text-ink-2">{p.task_progress.done}/{p.task_progress.total}</span>}</td>
                <td>
                  <select className="input h-7 w-auto text-xs" value={p.status} aria-label={`Status of ${p.title}`} onChange={(e) => void onStatus(p, e.target.value as ProjectStatus)}>
                    {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td><span className={`chip ${PRIORITY_CHIP[p.priority]}`}>{p.priority}</span></td>
                <td className="text-xs">{linkLabel(p).join(', ') || <span className="text-ink-2">Unlinked</span>}</td>
                <td className={`font-mono text-xs ${overdue(p) ? 'text-bad' : ''}`}>{p.due_date ?? '—'}</td>
                <td className="text-xs text-ink-2">{p.tags.map((t) => `#${t}`).join(' ')}</td>
                <td className="font-mono text-xs text-ink-2">{new Date(p.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-6 text-sm text-ink-2">No projects match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
