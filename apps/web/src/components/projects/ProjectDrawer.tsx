import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PROJECT_PRIORITIES, PROJECT_STATUSES, PROJECT_TITLE_MAX, type Project, type ProjectPriority, type ProjectStatus, type ProjectTask } from '@rackmap/shared';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { useFetch } from '../../lib/useFetch';
import { useLab } from '../../store/lab';
import { Markdown, toggleTaskLine } from '../../lib/markdown';
import { confirmDialog } from '../ui';
import { Icon } from '../Icon';
import { LinkPicker } from './LinkPicker';
import { panelTransition } from '../primitives';

export const STATUS_LABEL: Record<ProjectStatus, string> = { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete' };

/** Project detail drawer: editable fields, markdown description, checklist and links. */
export function ProjectDrawer({ projectId, onClose, onChanged, overlay }: { projectId: string; onClose: () => void; onChanged?: (p: Project | null) => void; overlay?: boolean }) {
  const { data: p, setData, reload } = useFetch<Project>(`/projects/${projectId}`, [projectId]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [editDesc, setEditDesc] = useState(false);
  const [tags, setTags] = useState('');
  const [newTask, setNewTask] = useState('');
  const { select } = useLab();
  useEffect(() => { if (p) { setTitle(p.title); setDesc(p.description_markdown); setTags(p.tags.join(', ')); } }, [p?.id, p?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea,[role=dialog]')) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const patch = async (body: Partial<Project>) => {
    try {
      const saved = await api.patch<Project>(`/projects/${projectId}`, body);
      setData(saved);
      onChanged?.(saved);
    } catch (e) { toast.error(e); void reload(); }
  };
  const taskOp = async (fn: () => Promise<unknown>) => {
    try { await fn(); const fresh = await api.get<Project>(`/projects/${projectId}`); setData(fresh); onChanged?.(fresh); } catch (e) { toast.error(e); }
  };

  const panel = (
    <motion.aside
      className={`panel flex w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-panel ${overlay ? 'fixed bottom-2 right-2 top-2 z-popover !shadow-lift' : 'h-full shrink-0 max-md:absolute max-md:inset-0 max-md:z-drawer max-md:w-auto'}`}
      initial={{ x: 12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={panelTransition} aria-label="Project details"
    >
      {!p ? <div className="p-4 text-sm text-ink-2">Loading…</div> : (
        <>
          <header className="flex items-center gap-2 border-b border-line px-3 py-3">
            <input className="input h-9 flex-1 border-transparent bg-transparent text-md font-medium hover:border-line-strong" value={title} maxLength={PROJECT_TITLE_MAX} aria-label="Project title"
              onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== p.title) void patch({ title: title.trim() }); else setTitle(p.title); }} />
            <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close project"><Icon name="close" size={14} /></button>
          </header>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-3">
              <label><span className="label">Status</span>
                <select className="input" value={p.status} onChange={(e) => void patch({ status: e.target.value as ProjectStatus })}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <label><span className="label">Priority</span>
                <select className="input" value={p.priority} onChange={(e) => void patch({ priority: e.target.value as ProjectPriority })}>
                  {PROJECT_PRIORITIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label><span className="label">Due</span><input type="date" className="input" value={p.due_date ?? ''} onChange={(e) => void patch({ due_date: e.target.value || null })} /></label>
            </div>
            {p.completed_at && <p className="-mt-3 text-xs text-ok">Completed {new Date(p.completed_at).toLocaleDateString()}</p>}
            <label className="block"><span className="label">Tags</span>
              <input className="input" value={tags} placeholder="comma separated" onChange={(e) => setTags(e.target.value)}
                onBlur={() => { const next = [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))]; if (next.join() !== p.tags.join()) void patch({ tags: next }); }} />
            </label>

            <section>
              <div className="mb-1 flex items-center justify-between">
                <span className="label mb-0">Description</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { if (editDesc && desc !== p.description_markdown) void patch({ description_markdown: desc }); setEditDesc(!editDesc); }}>
                  {editDesc ? 'Done' : 'Edit'}
                </button>
              </div>
              {editDesc ? (
                <div className="grid gap-2">
                  <textarea className="input min-h-[140px] font-mono text-xs" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description (Markdown)" />
                  <div className="surface-solid rounded-panel p-3"><Markdown source={desc || '_Nothing yet_'} /></div>
                </div>
              ) : p.description_markdown.trim()
                ? <Markdown source={p.description_markdown} onToggleTask={(l, c) => void patch({ description_markdown: toggleTaskLine(p.description_markdown, l, c) })} />
                : <p className="text-sm text-ink-2">No description yet.</p>}
            </section>

            <section aria-labelledby="checklist-h">
              <div className="mb-1 flex items-center justify-between">
                <h3 id="checklist-h" className="label mb-0">Checklist</h3>
                <span className="font-mono text-xs text-ink-2">{p.task_progress.done}/{p.task_progress.total}</span>
              </div>
              {p.task_progress.total > 0 && <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-track"><div className="h-full rounded-full bg-accent transition-[width] duration-base" style={{ width: `${(p.task_progress.done / p.task_progress.total) * 100}%` }} /></div>}
              <ul className="space-y-1">
                {p.tasks.map((t: ProjectTask) => (
                  <li key={t.id} className="group -mx-2 flex h-8 items-center gap-2 rounded-control px-2 text-sm hover:bg-surface-hover">
                    <input type="checkbox" checked={t.done} aria-label={t.text} onChange={(e) => void taskOp(() => api.patch(`/projects/${p.id}/tasks/${t.id}`, { done: e.target.checked }))} />
                    <span className={`flex-1 ${t.done ? 'text-ink-2 line-through' : 'text-ink'}`}>{t.text}</span>
                    <button className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${t.text}`} onClick={() => void taskOp(() => api.del(`/projects/${p.id}/tasks/${t.id}`))}><Icon name="close" size={11} /></button>
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newTask.trim()) return; const text = newTask; setNewTask(''); void taskOp(() => api.post(`/projects/${p.id}/tasks`, { text })); }}>
                <input className="input" placeholder="Add a step" value={newTask} onChange={(e) => setNewTask(e.target.value)} aria-label="New checklist item" />
                <button className="btn btn-sm btn-icon" aria-label="Add step"><Icon name="plus" size={12} /></button>
              </form>
            </section>

            <section aria-labelledby="links-h">
              <h3 id="links-h" className="label">Links</h3>
              {p.links.length === 0 && <p className="mb-2 text-sm text-ink-2">Not linked to a device or service yet.</p>}
              <ul className="mb-2 space-y-1">
                {p.links.map((l) => (
                  <li key={l.id} className="-mx-2 flex h-8 items-center gap-2 rounded-control px-2 text-sm hover:bg-surface-hover">
                    <Icon name="link" size={12} className="text-ink-3" />
                    <button className="link flex-1 truncate text-left"
                      onClick={() => { const id = l.device_id ?? l.service_device_id; if (id) select({ kind: 'device', id }); }}>
                      {l.device_name ?? `${l.service_name} (service)`}
                    </button>
                    <button className="btn btn-ghost btn-sm" aria-label={`Unlink ${l.device_name ?? l.service_name}`} onClick={async () => {
                      try { const fresh = await api.del<Project>(`/projects/${p.id}/links/${l.id}`); setData(fresh); onChanged?.(fresh); } catch (e) { toast.error(e); }
                    }}><Icon name="close" size={11} /></button>
                  </li>
                ))}
              </ul>
              <LinkPicker exclude={p.links.map((l) => (l.device_id ?? l.service_id)!)} onPick={async (t) => {
                try { const fresh = await api.post<Project>(`/projects/${p.id}/links`, t); setData(fresh); onChanged?.(fresh); } catch (e) { toast.error(e); }
              }} />
            </section>
          </div>
          <footer className="flex justify-between gap-2 border-t border-line px-4 py-3">
            <button className="btn btn-sm" onClick={() => void patch({ archived: !p.archived })}>{p.archived ? 'Unarchive' : 'Archive'}</button>
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (!(await confirmDialog({ title: 'Delete project?', message: `Delete "${p.title}"? Archive instead if you want to keep it in exports.`, danger: true, confirmLabel: 'Delete' }))) return;
              try { await api.del(`/projects/${p.id}`); onChanged?.(null); onClose(); } catch (e) { toast.error(e); }
            }}>Delete</button>
          </footer>
        </>
      )}
    </motion.aside>
  );
  if (!overlay) return panel;
  return (
    <>
      <div className="fixed inset-0 z-popover bg-black/40" onClick={onClose} aria-hidden />
      {panel}
    </>
  );
}
