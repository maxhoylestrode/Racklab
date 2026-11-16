import { useMemo, useState } from 'react';
import { DEVICE_CATEGORIES, PORT_KINDS, type DeviceTemplate, type PortKind, type PortLayoutEntry, type DeviceCategory } from '@rackmap/shared';
import { DeviceThumb, previewDevice } from '../../illustrations';
import { libraryDrag } from './RackScene';
import { useLab } from '../../store/lab';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Modal, confirmDialog } from '../ui';
import { Icon } from '../Icon';

const GROUPS: { label: string; cats: DeviceCategory[] }[] = [
  { label: 'Network', cats: ['router', 'switch', 'ap', 'patch_panel'] },
  { label: 'Compute', cats: ['server', 'pc', 'sbc', 'laptop', 'nas'] },
  { label: 'Rack', cats: ['shelf', 'ups'] },
  { label: 'Other', cats: ['other'] },
];

export function Library() {
  const { templates } = useLab();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<DeviceTemplate | 'new' | null>(null);
  const filtered = useMemo(() => templates.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())), [templates, q]);

  return (
    <aside className="no-print flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-[#0d121c]/80" aria-label="Device library">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Device library</h2>
        <input className="input" placeholder="Filter templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter templates" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="mb-2 px-1 text-[11px] leading-snug text-slate-500">Drag onto the rack. Loose gear (Pi, tower, laptop, router) goes on a shelf or in the unracked tray.</p>
        {GROUPS.map((grp) => {
          const items = filtered.filter((t) => grp.cats.includes(t.category));
          if (!items.length) return null;
          return (
            <section key={grp.label} className="mb-3">
              <h3 className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{grp.label}</h3>
              <ul className="space-y-1.5">
                {items.map((t) => (
                  <li key={t.id}>
                    <div
                      draggable
                      onDragStart={(e) => {
                        libraryDrag.templateId = t.id;
                        e.dataTransfer.setData('application/x-rackmap-template', t.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDragEnd={() => { libraryDrag.templateId = null; }}
                      className="group cursor-grab rounded-lg border border-slate-200 bg-white p-2 transition hover:border-sky-400 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-sky-600"
                      title={`${t.name}: ${t.form_factor === 'rack' ? `${t.height_u}U rack-mount` : 'loose, shelf or tray'}`}
                    >
                      <div className="flex justify-center rounded bg-[#0b0f17] p-1.5"><DeviceThumb device={previewDevice(t)} tpl={t} width={t.form_factor === 'loose' ? 90 : 180} /></div>
                      <div className="mt-1.5 flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.name}</span>
                        <span className="chip">{t.form_factor === 'rack' ? `${t.height_u}U` : 'loose'}</span>
                        <button className="rounded p-0.5 text-slate-400 opacity-0 hover:text-sky-400 focus:opacity-100 group-hover:opacity-100"
                          aria-label={t.is_builtin ? `Clone ${t.name}` : `Edit ${t.name}`} title={t.is_builtin ? 'Clone to edit' : 'Edit'}
                          onClick={async () => {
                            if (!t.is_builtin) return setEditing(t);
                            try {
                              const c = await api.post<DeviceTemplate>(`/templates/${t.id}/clone`);
                              useLab.setState((s) => ({ templates: [...s.templates, c] }));
                              setEditing(c);
                            } catch (e) { toast.error(e); }
                          }}>
                          <Icon name={t.is_builtin ? 'copy' : 'edit'} size={13} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <button className="btn w-full" onClick={() => setEditing('new')}><Icon name="plus" size={14} /> Custom template</button>
      </div>
      {editing && <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </aside>
  );
}

interface PortRow { label: string; kind: PortKind; speed_mbps: number | null; poe: boolean }

/** Evenly distributes ports across the face (two rows when there are many). */
function autoLayout(rows: PortRow[], heightU: number): PortLayoutEntry[] {
  const n = rows.length;
  const perRow = n > 16 ? Math.ceil(n / 2) : n;
  const x0 = 300, x1 = 960;
  return rows.map((r, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const x = perRow > 1 ? x0 + (col * (x1 - x0)) / (perRow - 1) : (x0 + x1) / 2;
    const y = perRow < n ? heightU * 100 * (row === 0 ? 0.32 : 0.7) : heightU * 50;
    return { ...r, x: Math.round(x), y: Math.round(y) };
  });
}

function TemplateEditor({ template, onClose }: { template: DeviceTemplate | null; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? 'Custom device');
  const [category, setCategory] = useState<DeviceCategory>(template?.category ?? 'other');
  const [form, setForm] = useState(template?.form_factor ?? 'rack');
  const [height, setHeight] = useState(template?.height_u ?? 1);
  const [width, setWidth] = useState(template?.width_fraction ?? 1);
  const [ports, setPorts] = useState<PortRow[]>(template?.port_layout.map(({ label, kind, speed_mbps, poe }) => ({ label, kind, speed_mbps, poe })) ?? []);
  const [keepPositions, setKeepPositions] = useState(!!template);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const layout = keepPositions && template && template.port_layout.length === ports.length
        ? template.port_layout.map((p, i) => ({ ...p, ...ports[i] }))
        : autoLayout(ports, height);
      const body = { name, category, form_factor: form, height_u: height, width_fraction: form === 'loose' ? width : 1, port_layout: layout, illustration_key: template?.illustration_key ?? 'generic' };
      const saved = template
        ? await api.patch<DeviceTemplate>(`/templates/${template.id}`, body)
        : await api.post<DeviceTemplate>('/templates', body);
      useLab.setState((s) => ({ templates: template ? s.templates.map((t) => (t.id === saved.id ? saved : t)) : [...s.templates, saved] }));
      toast.success(`Saved ${saved.name}`);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={template ? `Edit template: ${template.name}` : 'New custom template'} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label><span className="label">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DeviceCategory)}>
            {DEVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label><span className="label">Form factor</span>
          <select className="input" value={form} onChange={(e) => setForm(e.target.value as 'rack' | 'loose')}>
            <option value="rack">Rack-mount</option><option value="loose">Loose</option>
          </select>
        </label>
        <label><span className="label">Height (U)</span><input type="number" min={1} max={8} className="input" value={height} onChange={(e) => setHeight(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} /></label>
        {form === 'loose' && (
          <label><span className="label">Width</span>
            <select className="input" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
              <option value={0.5}>Half (shelf slot)</option><option value={1}>Full</option>
            </select>
          </label>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ports ({ports.length})</h3>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setPorts((p) => [...p, ...Array.from({ length: 4 }, (_, i) => ({ label: `Port ${p.length + i + 1}`, kind: 'rj45' as PortKind, speed_mbps: 1000, poe: false }))])}>+4 RJ45</button>
          <button className="btn btn-sm" onClick={() => setPorts((p) => [...p, { label: `Port ${p.length + 1}`, kind: 'rj45', speed_mbps: 1000, poe: false }])}><Icon name="plus" size={12} /> Port</button>
        </div>
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200 dark:border-slate-800">
        <table className="table-base">
          <thead><tr><th>Label</th><th>Kind</th><th>Speed (Mbps)</th><th>PoE</th><th /></tr></thead>
          <tbody>
            {ports.map((p, i) => (
              <tr key={i}>
                <td><input className="input py-1" value={p.label} aria-label={`Port ${i + 1} label`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                <td><select className="input py-1" value={p.kind} aria-label={`Port ${i + 1} kind`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, kind: e.target.value as PortKind } : x)))}>{PORT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
                <td><input type="number" className="input py-1" value={p.speed_mbps ?? ''} aria-label={`Port ${i + 1} speed`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, speed_mbps: e.target.value ? Number(e.target.value) : null } : x)))} /></td>
                <td><input type="checkbox" checked={p.poe} aria-label={`Port ${i + 1} PoE`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, poe: e.target.checked } : x)))} /></td>
                <td><button className="btn btn-ghost btn-sm" aria-label={`Remove port ${i + 1}`} onClick={() => setPorts((ps) => ps.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button></td>
              </tr>
            ))}
            {!ports.length && <tr><td colSpan={5} className="py-4 text-center text-xs text-slate-500">No ports yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {template && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={keepPositions} onChange={(e) => setKeepPositions(e.target.checked)} /> Keep existing port positions (when the port count is unchanged)</label>}
      <div className="mt-5 flex justify-between">
        {template ? (
          <button className="btn btn-danger" onClick={async () => {
            if (!(await confirmDialog({ title: 'Delete template?', message: `Delete ${template.name}? Templates in use cannot be deleted.`, danger: true, confirmLabel: 'Delete' }))) return;
            try {
              await api.del(`/templates/${template.id}`);
              useLab.setState((s) => ({ templates: s.templates.filter((t) => t.id !== template.id) }));
              onClose();
            } catch (e) { toast.error(e); }
          }}>Delete</button>
        ) : <span />}
        <div className="flex gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    </Modal>
  );
}
