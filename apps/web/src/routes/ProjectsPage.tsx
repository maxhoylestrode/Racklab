import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectStatus, ProjectStatusDef } from '@rackmap/shared';
import { useFetch } from '../lib/useFetch';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import { useUi } from '../store/ui';
import { useLab } from '../store/lab';
import { cvar, useProjectMeta } from '../store/projectMeta';
import { NewProjectDialog } from '../components/projects/NewProjectDialog';
import { ProjectDrawer } from '../components/projects/ProjectDrawer';
import { ProjectCustomiser } from '../components/projects/ProjectCustomiser';
import { ViewOptions } from '../components/projects/ViewOptions';
import { FloatingPanel, PillSelect, TagChip } from '../components/projects/controls';
import { Empty, Modal } from '../components/ui';
import { PageHeader, SummaryCard } from '../components/primitives';
import { usePrimaryAction } from '../store/chrome';
import { Icon, type IconName } from '../components/Icon';

type Meta = ReturnType<typeof useProjectMeta>;

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (p: Project, m: Meta) => !!p.due_date && !m.isDone(p.status) && p.due_date < today();
const linkLabel = (p: Project) => p.links.map((l) => l.device_name ?? l.service_name).filter(Boolean) as string[];
/** First line of the description as plain text, for the card preview. */
const plain = (md: string) => md.replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '').replace(/[#>*_`~[\]()!]/g, '').replace(/\s+/g, ' ').trim();

function projectCaption(ps: Project[], m: Meta): string {
  const late = ps.filter((p) => isOverdue(p, m)).length;
  const done = ps.reduce((n, p) => n + p.task_progress.done, 0), total = ps.reduce((n, p) => n + p.task_progress.total, 0);
  return [late ? `${late} overdue.` : 'Nothing overdue.', total ? `${done} of ${total} checklist steps done.` : ''].filter(Boolean).join(' ');
}

export default function ProjectsPage() {
  const { data, setData, reload } = useFetch<Project[]>('/projects');
  const { projectsView, setProjectsView } = useUi();
  const { loaded, load, refreshBadges } = useLab();
  const meta = useProjectMeta();
  const [creating, setCreating] = useState<ProjectStatus | true | false>(false);
  const [customising, setCustomising] = useState(false);
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
  const patch = async (p: Project, body: Partial<Project>) => {
    try { changed(await api.patch<Project>(`/projects/${p.id}`, body)); } catch (e) { toast.error(e); }
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

  const openCount = projects.filter((p) => !meta.isDone(p.status)).length;
  return (
    <div className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <PageHeader title="Projects" description="Planned homelab work, linked to the devices and services it touches."
          actions={<div className="no-print flex flex-wrap items-center gap-2">
            <ViewOptions view={projectsView} />
            <button className="btn" onClick={() => setCustomising(true)}><Icon name="palette" /> Customise</button>
            <div className="segmented" role="group" aria-label="Projects view">
              <button className="btn" aria-pressed={projectsView === 'board'} onClick={() => setProjectsView('board')}><Icon name="board" /> Board</button>
              <button className="btn" aria-pressed={projectsView === 'list'} onClick={() => setProjectsView('list')}><Icon name="list" /> List</button>
            </div>
          </div>} />
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          {data && meta.meta && <div className="max-lg:hidden"><SummaryCard label="Open projects" value={openCount} of={projects.length}
            caption={projectCaption(projects, meta)}
            bars={meta.statuses.map((s) => ({ label: s.label, value: projects.filter((p) => p.status === s.key).length, color: s.color }))} /></div>}
          <div className="min-w-0">
            {data && projects.length === 0 ? (
              <Empty title="No projects yet" action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>}>
                Plan homelab work here, such as “Add a second NIC to the R420” or “Build a CT for Jellyfin”. Link projects to devices and services, or keep them standalone.
              </Empty>
            ) : !meta.meta ? null : projectsView === 'board'
              ? <Board projects={projects} meta={meta} onOpen={setOpen} onMove={move} onPatch={patch} onAddColumn={() => setCustomising(true)}
                  onQuickAdd={async (status, title) => {
                    try { changed(await api.post<Project>('/projects', { title, status })); } catch (e) { toast.error(e); }
                  }} />
              : <ListView projects={projects} meta={meta} onOpen={setOpen} onPatch={patch} />}
          </div>
        </div>
      </div>
      {open && <ProjectDrawer key={open} projectId={open} onClose={() => setOpen(null)} onChanged={(p) => changed(p, open)} />}
      {creating && <NewProjectDialog presetStatus={typeof creating === 'string' ? creating : undefined} onClose={() => setCreating(false)} onCreated={(p) => changed(p)} />}
      <Modal open={customising} onClose={() => setCustomising(false)} title="Customise projects" width="max-w-2xl"
        description="Statuses, priorities and tag colours are shared by everyone using this RackMap. Card and list layout is under View and saved per browser.">
        <ProjectCustomiser onChanged={() => void reload()} />
      </Modal>
    </div>
  );
}

// ---------------- Kanban ----------------
function Board({ projects, meta, onOpen, onMove, onPatch, onQuickAdd, onAddColumn }: {
  projects: Project[]; meta: Meta; onOpen: (id: string) => void; onMove: (id: string, s: ProjectStatus, i: number) => Promise<void>;
  onPatch: (p: Project, b: Partial<Project>) => Promise<void>; onQuickAdd: (s: ProjectStatus, title: string) => Promise<void>; onAddColumn: () => void;
}) {
  const { projectDisplay: display, setProjectDisplay } = useUi();
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ status: ProjectStatus; index: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const cols = useMemo(() => Object.fromEntries(meta.statuses.map((s) => [s.key, projects.filter((p) => p.status === s.key).sort((a, b) => a.sort_order - b.sort_order)])) as Record<ProjectStatus, Project[]>, [projects, meta.statuses]);
  const isCollapsed = (s: ProjectStatusDef) => display.collapsed[s.key] ?? s.kind === 'done';
  const toggle = (s: ProjectStatusDef) => setProjectDisplay((d) => ({ ...d, collapsed: { ...d.collapsed, [s.key]: !isCollapsed(s) } }));

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
    <div className="flex flex-col gap-4 pb-2 md:flex-row md:overflow-x-auto">
      <p id="card-kbd-hint" className="sr-only">Enter opens the project. M opens the status and priority menu. Alt plus Up or Down reorders within the column.</p>
      {meta.statuses.map((s) => {
        const list = cols[s.key] ?? [];
        const collapsed = isCollapsed(s);
        return (
          <section key={s.key} aria-label={`${s.label} column`}
            className={`flex min-h-[200px] flex-col rounded-panel p-1 ${collapsed ? 'md:w-[168px] md:shrink-0' : 'md:min-w-[232px] md:flex-1'} ${drop?.status === s.key ? 'outline-dashed outline-1 outline-offset-2' : ''}`}
            style={drop?.status === s.key ? { outlineColor: s.color } : undefined}
            onDragOver={(e) => { if (drag) { e.preventDefault(); if (drop?.status !== s.key || list.length === 0) setDrop({ status: s.key, index: list.length }); } }}
            onDrop={(e) => { e.preventDefault(); void finishDrop(s.key, drop?.status === s.key ? drop.index : list.length); }}>
            <header className="mb-2 flex h-8 items-center gap-2 px-1">
              <button className="btn btn-ghost btn-sm btn-icon" aria-expanded={!collapsed} aria-label={collapsed ? `Expand ${s.label}` : `Collapse ${s.label}`} onClick={() => toggle(s)}>
                <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
              </button>
              <h2 className="pill min-w-0" style={cvar(s.color)}><span className="pill-dot" aria-hidden /><span className="truncate">{s.label}</span></h2>
              <span className="font-mono text-xs text-ink-2">{list.length}</span>
            </header>
            {!collapsed && <QuickAdd onAdd={(t) => onQuickAdd(s.key, t)} label={s.label} />}
            {collapsed ? (
              <p className="px-2 text-sm text-ink-2">{list.length} project{list.length === 1 ? '' : 's'}. Expand to see {list.length === 1 ? 'it' : 'them'}, or drop a card here.</p>
            ) : (
              <ol className={`flex flex-1 flex-col ${display.density === 'compact' ? 'gap-1.5' : 'gap-2'}`}>
                {list.map((p, i) => (
                  <li key={p.id}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault(); e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setDrop({ status: s.key, index: e.clientY < r.top + r.height / 2 ? i : i + 1 });
                    }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void finishDrop(s.key, drop?.status === s.key ? drop.index : i); }}>
                    {drop?.status === s.key && drop.index === i && drag !== p.id && <div className="mb-2 h-0.5 rounded-full" style={{ background: s.color }} />}
                    <Card p={p} meta={meta} dragging={drag === p.id} onOpen={() => onOpen(p.id)}
                      onDragStart={() => setDrag(p.id)} onDragEnd={() => { setDrag(null); setDrop(null); }}
                      menuOpen={menu === p.id} setMenu={(o) => setMenu(o ? p.id : null)}
                      onStatus={(st) => void onMove(p.id, st, (cols[st] ?? []).length)}
                      onPriority={(pr) => void onPatch(p, { priority: pr })}
                      onShift={(d) => { const j = i + d; if (j >= 0 && j < list.length) void onMove(p.id, s.key, j); }} />
                    {drop?.status === s.key && drop.index === list.length && i === list.length - 1 && <div className="mt-2 h-0.5 rounded-full" style={{ background: s.color }} />}
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
      <button className="btn btn-ghost btn-icon no-print h-8 w-8 shrink-0 self-start border border-dashed border-line-strong text-ink-2 max-md:w-full md:mt-1"
        onClick={onAddColumn} aria-label="Add or edit columns" title="Add or edit columns">
        <Icon name="plus" />
      </button>
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

function Card({ p, meta, dragging, onOpen, onDragStart, onDragEnd, menuOpen, setMenu, onStatus, onPriority, onShift }: {
  p: Project; meta: Meta; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void;
  menuOpen: boolean; setMenu: (o: boolean) => void; onStatus: (s: ProjectStatus) => void; onPriority: (p: string) => void; onShift: (d: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const { projectDisplay: { cardFields: f, density } } = useUi();
  const compact = density === 'compact';
  const links = linkLabel(p);
  const pr = meta.priority(p.priority);
  const done = meta.isDone(p.status);
  const late = isOverdue(p, meta);
  const desc = f.description ? plain(p.description_markdown) : '';
  const showChips = f.priority || (f.due && p.due_date) || (f.links && links.length > 0);
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
      data-accent={p.color ? '' : undefined} style={p.color ? ({ '--card-c': p.color } as React.CSSProperties) : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') onOpen();
        else if (e.key.toLowerCase() === 'm') { e.preventDefault(); setMenu(true); }
        else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); onShift(-1); }
        else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); onShift(1); }
      }}
      className={`kanban-card panel group relative cursor-pointer rounded-panel hover:border-line-strong ${compact ? 'px-3 py-2' : 'p-3'} ${dragging ? 'border-dashed !shadow-none opacity-40' : ''}`}>
      <div className="flex items-start gap-2">
        {f.icon && p.icon && (
          <span className={`icon-tile ${compact ? 'h-5 w-5' : 'h-6 w-6'}`} style={p.color ? { color: p.color } : undefined} aria-hidden>
            <Icon name={p.icon as IconName} size={14} />
          </span>
        )}
        <p className={`flex-1 text-sm font-medium ${compact ? '' : 'pt-0.5'} ${done ? 'text-ink-2 line-through' : 'text-ink'}`}>{p.title}</p>
        <button ref={moreBtn} className="btn btn-ghost btn-sm btn-icon -mr-1 -mt-1 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Change status or priority of ${p.title}`}
          onClick={(e) => { e.stopPropagation(); setMenu(!menuOpen); }}><Icon name="more" /></button>
      </div>
      {desc && <p className={`line-clamp-2 text-xs text-ink-2 ${compact ? 'mt-1' : 'mt-1.5'}`}>{desc}</p>}
      {showChips && (
        <div className={`flex flex-wrap items-center gap-1 ${compact ? 'mt-1.5' : 'mt-3'}`}>
          {f.priority && <span className="pill pill-sm" style={cvar(pr.color)}><span className="pill-dot" aria-hidden />{pr.label}</span>}
          {f.due && p.due_date && <span className={`chip tabular ${late ? 'chip-bad' : ''}`}>{late ? 'Overdue ' : 'Due '}{p.due_date}</span>}
          {f.links && links.map((l) => <span key={l} className="chip max-w-full"><span className="truncate">{l}</span></span>)}
        </div>
      )}
      {f.tags && p.tags.length > 0 && <div className={`flex flex-wrap gap-1 ${compact ? 'mt-1' : 'mt-2'}`}>{p.tags.map((t) => <TagChip key={t} tag={t} color={meta.tagColor(t)} />)}</div>}
      {f.checklist && p.task_progress.total > 0 && (
        <div className={`flex items-center gap-2 ${compact ? 'mt-1.5' : 'mt-2'}`} aria-label={`${p.task_progress.done} of ${p.task_progress.total} steps done`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-track"><div className="h-full rounded-full bg-accent" style={{ width: `${(p.task_progress.done / p.task_progress.total) * 100}%`, ...(p.color ? { background: p.color } : {}) }} /></div>
          <span className="font-mono text-xs text-ink-2">{p.task_progress.done}/{p.task_progress.total}</span>
        </div>
      )}
      {menuOpen && <CardMenu p={p} meta={meta} anchor={moreBtn} close={() => { setMenu(false); ref.current?.focus(); }} onStatus={onStatus} onPriority={onPriority} />}
    </div>
  );
}

function CardMenu({ p, meta, anchor, close, onStatus, onPriority }: {
  p: Project; meta: Meta; anchor: React.RefObject<HTMLButtonElement>; close: () => void; onStatus: (s: ProjectStatus) => void; onPriority: (p: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const Item = ({ checked, color, label, onPick, autoFocus }: { checked: boolean; color: string; label: string; onPick: () => void; autoFocus?: boolean }) => (
    <button role="menuitemradio" aria-checked={checked} autoFocus={autoFocus} className="menu-item"
      onClick={() => { close(); if (!checked) onPick(); }}>
      <span className="pill-dot" style={cvar(color)} aria-hidden /><span className="flex-1 truncate">{label}</span>
      <span className="flex w-4 justify-center text-ink-2">{checked && <Icon name="check" size={12} />}</span>
    </button>
  );
  return (
    <FloatingPanel anchor={anchor} open onClose={close} role="presentation" className="w-52">
    <div ref={ref} role="menu" aria-label={`${p.title} status and priority`}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      }}>
      <p className="eyebrow px-2 pb-1 pt-1.5">Status</p>
      {meta.statuses.map((s) => <Item key={s.key} checked={p.status === s.key} autoFocus={p.status === s.key} color={s.color} label={s.label} onPick={() => onStatus(s.key)} />)}
      <div className="menu-sep" />
      <p className="eyebrow px-2 pb-1 pt-1.5">Priority</p>
      {meta.priorities.map((x) => <Item key={x.key} checked={p.priority === x.key} color={x.color} label={x.label} onPick={() => onPriority(x.key)} />)}
    </div>
    </FloatingPanel>
  );
}

// ---------------- List ----------------
function Filter({ label, value, set, options, w = 'w-[150px]' }: { label: string; value: string; set: (v: string) => void; options: { value: string; label: string; color?: string }[]; w?: string }) {
  return <div><span className="label">{label}</span><PillSelect variant="field" className={w} label={`${label} filter`} value={value} onChange={set} options={options} /></div>;
}
type SortKey = 'default' | 'title' | 'status' | 'priority' | 'due' | 'updated';

function ListView({ projects, meta, onOpen, onPatch }: { projects: Project[]; meta: Meta; onOpen: (id: string) => void; onPatch: (p: Project, b: Partial<Project>) => Promise<void> }) {
  const { devices } = useLab();
  const cols = useUi((s) => s.projectDisplay.listColumns);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [linked, setLinked] = useState('');
  const [device, setDevice] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'default', dir: 1 });
  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags))].sort(), [projects]);
  const sRank = (k: string) => meta.status(k).sort_order, pRank = (k: string) => meta.priority(k).sort_order;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = projects.filter((p) =>
      (!status || p.status === status) && (!priority || p.priority === priority)
      && (!linked || (linked === 'linked' ? p.links.length > 0 : p.links.length === 0))
      && (!device || p.links.some((l) => l.device_id === device || l.service_device_id === device))
      && (!tag || p.tags.includes(tag))
      && (!needle || `${p.title} ${p.description_markdown} ${p.tags.join(' ')} ${linkLabel(p).join(' ')}`.toLowerCase().includes(needle)));
    const byDefault = (a: Project, b: Project) =>
      sRank(a.status) - sRank(b.status) || pRank(a.priority) - pRank(b.priority)
      || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title);
    const cmp: Record<SortKey, (a: Project, b: Project) => number> = {
      default: byDefault,
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => sRank(a.status) - sRank(b.status),
      priority: (a, b) => pRank(a.priority) - pRank(b.priority),
      due: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    };
    return [...filtered].sort((a, b) => cmp[sort.key](a, b) * sort.dir || byDefault(a, b));
  }, [projects, status, priority, linked, device, tag, q, sort, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 uppercase tracking-label hover:text-ink" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {children}{sort.key === k && <Icon name={sort.dir === 1 ? 'chevronUp' : 'chevronDown'} className="text-accent" />}
      </button>
    </th>
  );
  const any = { value: '', label: 'Any' };
  const nCols = 1 + Object.values(cols).filter(Boolean).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1"><span className="label">Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, description, tag" /></label>
        <Filter label="Status" value={status} set={setStatus} options={[any, ...meta.statuses.map((s) => ({ value: s.key, label: s.label, color: s.color }))]} />
        <Filter label="Priority" value={priority} set={setPriority} options={[any, ...meta.priorities.map((s) => ({ value: s.key, label: s.label, color: s.color }))]} />
        <Filter label="Links" value={linked} set={setLinked} w="w-[120px]" options={[{ value: '', label: 'All' }, { value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Unlinked' }]} />
        <Filter label="Device" value={device} set={setDevice} w="w-[160px]" options={[any, ...devices.map((d) => ({ value: d.id, label: d.name }))]} />
        <Filter label="Tag" value={tag} set={setTag} w="w-[130px]" options={[any, ...allTags.map((t) => ({ value: t, label: `#${t}`, color: meta.tagColor(t) ?? undefined }))]} />
      </div>
      <div className="panel overflow-x-auto rounded-panel">
        <table className="table-base">
          <thead><tr>
            <Th k="title">Title</Th>
            {cols.status && <Th k="status">Status</Th>}
            {cols.priority && <Th k="priority">Priority</Th>}
            {cols.links && <th>Linked to</th>}
            {cols.due && <Th k="due">Due</Th>}
            {cols.tags && <th>Tags</th>}
            {cols.progress && <th>Checklist</th>}
            {cols.updated && <Th k="updated">Updated</Th>}
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="flex items-center gap-2 text-left text-ink hover:text-accent" onClick={() => onOpen(p.id)}>
                    {p.icon ? <span style={p.color ? { color: p.color } : undefined} className="text-ink-2"><Icon name={p.icon as IconName} size={14} /></span>
                      : p.color ? <span className="pill-dot" style={cvar(p.color)} aria-hidden /> : null}
                    <span className={meta.isDone(p.status) ? 'text-ink-2 line-through' : ''}>{p.title}</span>
                  </button>
                </td>
                {cols.status && <td><PillSelect size="sm" label={`Status of ${p.title}`} value={p.status} onChange={(v) => void onPatch(p, { status: v })}
                  options={meta.statuses.map((s) => ({ value: s.key, label: s.label, color: s.color }))} /></td>}
                {cols.priority && <td><PillSelect size="sm" label={`Priority of ${p.title}`} value={p.priority} onChange={(v) => void onPatch(p, { priority: v })}
                  options={meta.priorities.map((s) => ({ value: s.key, label: s.label, color: s.color }))} /></td>}
                {cols.links && <td className="text-xs">{linkLabel(p).join(', ') || <span className="text-ink-2">Unlinked</span>}</td>}
                {cols.due && <td className={`font-mono text-xs ${isOverdue(p, meta) ? 'text-bad' : ''}`}>{p.due_date ?? '—'}</td>}
                {cols.tags && <td><div className="flex flex-wrap gap-1">{p.tags.map((t) => <TagChip key={t} tag={t} color={meta.tagColor(t)} />)}</div></td>}
                {cols.progress && <td className="font-mono text-xs text-ink-2">{p.task_progress.total ? `${p.task_progress.done}/${p.task_progress.total}` : '—'}</td>}
                {cols.updated && <td className="font-mono text-xs text-ink-2">{new Date(p.updated_at).toLocaleDateString()}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={nCols} className="py-6 text-sm text-ink-2">No projects match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
