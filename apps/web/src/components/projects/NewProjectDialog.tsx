import { useState } from 'react';
import { PROJECT_TITLE_MAX, type Project, type ProjectIcon } from '@rackmap/shared';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { useLab } from '../../store/lab';
import { Modal } from '../ui';
import { Icon } from '../Icon';
import { LinkPicker, type LinkTarget } from './LinkPicker';
import { useProjectMeta } from '../../store/projectMeta';
import { ColorPicker, IconPicker, PillSelect } from './controls';

export function NewProjectDialog({ presetLink, presetStatus, onClose, onCreated }: { presetLink?: LinkTarget; presetStatus?: string; onClose: () => void; onCreated?: (p: Project) => void }) {
  const meta = useProjectMeta();
  const devices = useLab((s) => s.devices);
  const presetName = presetLink && 'device_id' in presetLink ? devices.find((d) => d.id === presetLink.device_id)?.name : undefined;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Empty means "server default": the first column and the middle priority.
  const [status, setStatus] = useState(presetStatus ?? '');
  const [priority, setPriority] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<ProjectIcon | null>(null);
  const shownStatus = status || meta.statuses[0]?.key || '';
  const shownPriority = priority || meta.priorities[Math.floor(meta.priorities.length / 2)]?.key || '';
  const [due, setDue] = useState('');
  const [tags, setTags] = useState('');
  const [links, setLinks] = useState<{ t: LinkTarget; label: string }[]>(presetLink ? [{ t: presetLink, label: presetName ?? 'Linked item' }] : []);
  const [busy, setBusy] = useState(false);
  const key = (t: LinkTarget) => ('device_id' in t ? t.device_id : t.service_id);
  return (
    <Modal open onClose={onClose} title="New project" width="max-w-lg">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const p = await api.post<Project>('/projects', {
            title, description_markdown: description, due_date: due || null, color, icon,
            ...(status ? { status } : {}), ...(priority ? { priority } : {}),
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean), links: links.map((l) => l.t),
          });
          toast.success('Project created');
          onCreated?.(p);
          onClose();
        } catch (err) { toast.error(err); } finally { setBusy(false); }
      }}>
        <div className="flex items-end gap-2">
        <IconPicker value={icon} color={color} onChange={setIcon} />
        <label className="block min-w-0 flex-1"><span className="label">Title</span>
          <input className="input" value={title} maxLength={PROJECT_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="Add a second NIC to the R420" />
        </label>
        <div className="flex h-9 items-center"><ColorPicker allowNone label="Card colour" value={color} onChange={setColor} /></div>
        </div>
        <label className="block"><span className="label">Description (Markdown)</span>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div><span className="label">Status</span>
            <PillSelect variant="field" label="Status" value={shownStatus} onChange={setStatus}
              options={meta.statuses.map((s) => ({ value: s.key, label: s.label, color: s.color }))} />
          </div>
          <div><span className="label">Priority</span>
            <PillSelect variant="field" label="Priority" value={shownPriority} onChange={setPriority}
              options={meta.priorities.map((s) => ({ value: s.key, label: s.label, color: s.color }))} />
          </div>
          <label><span className="label">Due date</span><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        <label className="block"><span className="label">Tags</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma separated" /></label>
        <div>
          <span className="label">Link to (optional)</span>
          <LinkPicker exclude={links.map((l) => key(l.t))} onPick={(t, label) => setLinks((ls) => [...ls, { t, label }])} />
          {links.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {links.map((l) => (
                <span key={key(l.t)} className="chip">
                  {l.label}
                  <button type="button" aria-label={`Remove link to ${l.label}`} onClick={() => setLinks((ls) => ls.filter((x) => key(x.t) !== key(l.t)))}><Icon name="close" size={10} /></button>
                </span>
              ))}
            </div>
          ) : <p className="mt-1 text-xs text-ink-2">Leave blank for a standalone project. You can link it later.</p>}
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !title.trim()}>Create project</button></div>
      </form>
    </Modal>
  );
}
