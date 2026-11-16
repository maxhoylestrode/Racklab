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
      className={`flex w-[440px] max-w-[94vw] flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0d121c] ${overlay ? 'fixed inset-y-0 right-0 z-40 shadow-2xl' : 'h-full shrink-0'}`}
      initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.18 }} aria-label="Project details"
    >
      {!p ? <div className="p-4 text-sm text-slate-500">Loading…</div> : (
        <>
          <header className="flex items-start gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
            <input className="input flex-1 text-base font-semibold" value={title} maxLength={PROJECT_TITLE_MAX} aria-label="Project title"
              onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== p.title) void patch({ title: title.trim() }); else setTitle(p.title); }} />
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close project"><Icon name="close" size={14} /></button>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-2">
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
            {p.completed_at && <p className="text-xs text-emerald-600 dark:text-emerald-400">Completed {new Date(p.completed_at).toLocaleDateString()}</p>}
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
                  <div className="rounded-md border border-slate-200 p-2 dark:border-slate-800"><Markdown source={desc || '_Nothing yet_'} /></div>
                </div>
              ) : p.description_markdown.trim()
                ? <Markdown source={p.description_markdown} onToggleTask={(l, c) => void patch({ description_markdown: toggleTaskLine(p.description_markdown, l, c) })} />
                : <p className="text-xs text-slate-500">No description.</p>}
            </section>

            <section aria-labelledby="checklist-h">
              <div className="mb-1 flex items-center justify-between">
                <h3 id="checklist-h" className="label mb-0">Checklist</h3>
                <span className="text-xs text-slate-500">{p.task_progress.done} of {p.task_progress.total}</span>
              </div>
              {p.task_progress.total > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"><div className="h-full bg-emerald-500" style={{ width: `${(p.task_progress.done / p.task_progress.total) * 100}%` }} /></div>}
              <ul className="space-y-1">
                {p.tasks.map((t: ProjectTask) => (
                  <li key={t.id} className="group flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={t.done} aria-label={t.text} onChange={(e) => void taskOp(() => api.patch(`/projects/${p.id}/tasks/${t.id}`, { done: e.target.checked }))} />
                    <span className={`flex-1 ${t.done ? 'text-slate-500 line-through' : ''}`}>{t.text}</span>
                    <button className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${t.text}`} onClick={() => void taskOp(() => api.del(`/projects/${p.id}/tasks/${t.id}`))}><Icon name="close" size={11} /></button>
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (!newTask.trim()) return; const text = newTask; setNewTask(''); void taskOp(() => api.post(`/projects/${p.id}/tasks`, { text })); }}>
                <input className="input py-1" placeholder="Add a step" value={newTask} onChange={(e) => setNewTask(e.target.value)} aria-label="New checklist item" />
                <button className="btn btn-sm" aria-label="Add step"><Icon name="plus" size={12} /></button>
              </form>
            </section>

            <section aria-labelledby="links-h">
              <h3 id="links-h" className="label">Links</h3>
              {p.links.length === 0 && <p className="mb-2 text-xs text-slate-500">Not linked to anything yet.</p>}
              <ul className="mb-2 space-y-1">
                {p.links.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    <Icon name="link" size={12} className="text-slate-400" />
                    <button className="flex-1 truncate text-left text-sky-600 hover:underline dark:text-sky-400"
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
          <footer className="flex justify-between gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
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
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} aria-hidden />
      {panel}
    </>
  );
}
