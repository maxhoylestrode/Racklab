import { useEffect, useState } from 'react';
import type { Note } from '@rackmap/shared';
import { useFetch } from '../../lib/useFetch';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Markdown, toggleTaskLine } from '../../lib/markdown';
import { confirmDialog } from '../ui';
import { Icon } from '../Icon';

type Scope = { device_id: string } | { service_id: string } | { global: true };

/** Markdown notes with live preview, pinning, search and clickable checklists. Used in the drawer and the Docs page. */
export function NotesPanel({ scope }: { scope: Scope }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const base = 'device_id' in scope ? `device_id=${scope.device_id}` : 'service_id' in scope ? `service_id=${scope.service_id}` : 'scope=global';
  const notes = useFetch<Note[]>(`/notes?${base}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const patch = async (n: Note, body: Partial<Note>) => {
    try {
      const saved = await api.patch<Note>(`/notes/${n.id}`, body);
      notes.setData((xs) => xs?.map((x) => (x.id === saved.id ? saved : x)) ?? null);
    } catch (e) { toast.error(e); }
  };

  if (editing) {
    return <NoteEditor note={editing === 'new' ? null : editing} scope={scope} onDone={() => { setEditing(null); void notes.reload(); }} />;
  }
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-7" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        </div>
        <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" size={13} /> Note</button>
      </div>
      {!notes.data?.length && <p className="text-xs text-slate-500">{debounced ? 'No notes match.' : 'No notes yet. Markdown, code blocks and - [ ] checklists all work.'}</p>}
      <ul className="space-y-2">
        {notes.data?.map((n) => {
          const open = expanded === n.id || (notes.data!.length === 1);
          return (
            <li key={n.id} className="rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1 px-3 py-2">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={() => setExpanded(open ? null : n.id)}>
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="text-slate-400" />
                  <span className="truncate text-sm font-medium">{n.title}</span>
                </button>
                <button className={`btn btn-ghost btn-sm ${n.pinned ? 'text-amber-500' : 'text-slate-400'}`} aria-pressed={n.pinned} aria-label={n.pinned ? 'Unpin' : 'Pin'} onClick={() => void patch(n, { pinned: !n.pinned })}><Icon name="pin" size={12} /></button>
                <button className="btn btn-ghost btn-sm" aria-label={`Edit ${n.title}`} onClick={() => setEditing(n)}><Icon name="edit" size={12} /></button>
                <button className="btn btn-ghost btn-sm" aria-label={`Delete ${n.title}`} onClick={async () => {
                  if (!(await confirmDialog({ title: 'Delete note?', message: `Delete "${n.title}"?`, danger: true, confirmLabel: 'Delete' }))) return;
                  try { await api.del(`/notes/${n.id}`); void notes.reload(); } catch (e) { toast.error(e); }
                }}><Icon name="trash" size={12} /></button>
              </div>
              {open && (
                <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-800">
                  {n.body_markdown.trim() ? (
                    <Markdown source={n.body_markdown} onToggleTask={(line, checked) => void patch(n, { body_markdown: toggleTaskLine(n.body_markdown, line, checked) })} />
                  ) : <p className="text-xs text-slate-500">Empty note.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NoteEditor({ note, scope, onDone }: { note: Note | null; scope: Scope; onDone: () => void }) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body_markdown ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [view, setView] = useState<'split' | 'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const owner = 'device_id' in scope ? { device_id: scope.device_id } : 'service_id' in scope ? { service_id: scope.service_id } : {};
      if (note) await api.patch(`/notes/${note.id}`, { title, body_markdown: body, pinned });
      else await api.post('/notes', { ...owner, title, body_markdown: body, pinned });
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <input className="input text-base font-medium" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" autoFocus />
      <div className="flex items-center gap-1" role="group" aria-label="Editor view">
        {(['write', 'preview', 'split'] as const).map((v) => (
          <button key={v} className={`btn btn-sm ${view === v ? 'btn-on' : 'btn-ghost'}`} aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned</label>
      </div>
      <div className={view === 'split' ? 'grid grid-cols-2 gap-2' : ''}>
        {view !== 'preview' && (
          <textarea className="input min-h-[260px] font-mono text-xs leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Note body (Markdown)"
            placeholder={'## Heading\n\n- [ ] a checklist item\n\n```bash\nssh root@pve\n```'} />
        )}
        {view !== 'write' && (
          <div className="min-h-[260px] overflow-auto rounded-md border border-slate-200 p-3 dark:border-slate-800">
            {body.trim() ? <Markdown source={body} onToggleTask={(l, c) => setBody(toggleTaskLine(body, l, c))} /> : <p className="text-xs text-slate-500">Nothing to preview.</p>}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>
      </div>
    </div>
  );
}
