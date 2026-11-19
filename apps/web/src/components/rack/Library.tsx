import { useMemo, useState } from 'react';
import { DEVICE_CATEGORIES, PORT_KINDS, type DeviceTemplate, type PortKind, type PortLayoutEntry, type DeviceCategory } from '@rackmap/shared';
import { DeviceThumb, previewDevice } from '../../illustrations';
import { libraryDrag } from './RackScene';
import { useLab } from '../../store/lab';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Modal, confirmDialog } from '../ui';
import { Icon } from '../Icon';
import { SearchInput } from '../primitives';
import { Dropdown } from '../Select';

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
    <aside className="panel no-print flex shrink-0 flex-col overflow-hidden rounded-panel max-md:order-last max-md:h-44 md:w-64" aria-label="Device library">
      <div className="flex items-center gap-2 border-b border-line p-3 max-md:py-2">
        <h2 className="eyebrow mr-auto shrink-0">Library</h2>
        <SearchInput wrapperClassName="min-w-0 flex-1 md:max-w-[148px]" className="h-7 text-xs" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter templates" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 max-md:flex max-md:gap-4">
        <p className="mb-2 px-2 text-xs text-ink-2 max-md:hidden">Drag onto the rack. Loose gear goes on a shelf or in the unracked tray.</p>
        {GROUPS.map((grp) => {
          const items = filtered.filter((t) => grp.cats.includes(t.category));
          if (!items.length) return null;
          return (
            <section key={grp.label} className="mb-3 max-md:mb-0 max-md:shrink-0">
              <h3 className="eyebrow px-2 pb-1">{grp.label}</h3>
              <ul className="max-md:flex max-md:gap-1">
                {items.map((t) => (
                  <li key={t.id} className="max-md:w-36 max-md:shrink-0">
                    <div
                      draggable
                      onDragStart={(e) => {
                        libraryDrag.templateId = t.id;
                        e.dataTransfer.setData('application/x-rackmap-template', t.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDragEnd={() => { libraryDrag.templateId = null; }}
                      className="group cursor-grab rounded-control p-2 transition-colors duration-fast hover:bg-surface-hover active:cursor-grabbing"
                      title={`${t.name}: ${t.form_factor === 'rack' ? `${t.height_u}U rack-mount` : 'loose, shelf or tray'}`}
                    >
                      <div className="flex h-12 items-center justify-center rounded-sm bg-[#16181b] px-2 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)]">
                        <DeviceThumb device={previewDevice(t)} tpl={t} width={t.form_factor === 'loose' ? 72 : 196} />
                      </div>
                      <div className="mt-2 flex h-5 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                        <span className="shrink-0 font-mono text-xs text-ink-2">{t.form_factor === 'rack' ? `${t.height_u}U` : 'loose'}</span>
                        <button className="-my-1 rounded-control p-1 text-ink-2 opacity-0 transition-opacity duration-fast hover:bg-surface-hover hover:text-ink focus:opacity-100 group-hover:opacity-100"
                          aria-label={t.is_builtin ? `Clone ${t.name}` : `Edit ${t.name}`} title={t.is_builtin ? 'Clone to edit' : 'Edit'}
                          onClick={async () => {
                            if (!t.is_builtin) return setEditing(t);
                            try {
                              const c = await api.post<DeviceTemplate>(`/templates/${t.id}/clone`);
                              useLab.setState((s) => ({ templates: [...s.templates, c] }));
                              setEditing(c);
                            } catch (e) { toast.error(e); }
                          }}>
                          <Icon name={t.is_builtin ? 'copy' : 'edit'} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!filtered.length && <p className="px-2 text-sm text-ink-2">No templates match “{q}”.</p>}
      </div>
      <div className="border-t border-line p-2 max-md:hidden">
        <button className="btn btn-ghost w-full justify-start" onClick={() => setEditing('new')}><Icon name="plus" /> Custom template</button>
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
          <Dropdown label="Category" value={category} onChange={(v) => setCategory(v as DeviceCategory)}
            options={DEVICE_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') }))} />
        </label>
        <label><span className="label">Form factor</span>
          <Dropdown label="Form factor" value={form} onChange={(v) => setForm(v as 'rack' | 'loose')}
            options={[{ value: 'rack', label: 'Rack-mount' }, { value: 'loose', label: 'Loose' }]} />
        </label>
        <label><span className="label">Height (U)</span><input type="number" min={1} max={8} className="input" value={height} onChange={(e) => setHeight(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} /></label>
        {form === 'loose' && (
          <label><span className="label">Width</span>
            <Dropdown label="Width" value={String(width)} onChange={(v) => setWidth(Number(v))}
              options={[{ value: '0.5', label: 'Half (shelf slot)' }, { value: '1', label: 'Full' }]} />
          </label>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">Ports ({ports.length})</h3>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setPorts((p) => [...p, ...Array.from({ length: 4 }, (_, i) => ({ label: `Port ${p.length + i + 1}`, kind: 'rj45' as PortKind, speed_mbps: 1000, poe: false }))])}>+4 RJ45</button>
          <button className="btn btn-sm" onClick={() => setPorts((p) => [...p, { label: `Port ${p.length + 1}`, kind: 'rj45', speed_mbps: 1000, poe: false }])}><Icon name="plus" size={12} /> Port</button>
        </div>
      </div>
      <div className="surface-solid mt-2 max-h-64 overflow-y-auto rounded-panel">
        <table className="table-base table-compact">
          <thead><tr><th>Label</th><th>Kind</th><th>Speed (Mbps)</th><th>PoE</th><th /></tr></thead>
          <tbody>
            {ports.map((p, i) => (
              <tr key={i}>
                <td><input className="input py-1" value={p.label} aria-label={`Port ${i + 1} label`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                <td><Dropdown size="sm" label={`Port ${i + 1} kind`} value={p.kind} onChange={(v) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, kind: v as PortKind } : x)))} options={PORT_KINDS.map((k) => ({ value: k, label: k }))} /></td>
                <td><input type="number" className="input py-1" value={p.speed_mbps ?? ''} aria-label={`Port ${i + 1} speed`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, speed_mbps: e.target.value ? Number(e.target.value) : null } : x)))} /></td>
                <td><input type="checkbox" checked={p.poe} aria-label={`Port ${i + 1} PoE`} onChange={(e) => setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, poe: e.target.checked } : x)))} /></td>
                <td><button className="btn btn-ghost btn-sm" aria-label={`Remove port ${i + 1}`} onClick={() => setPorts((ps) => ps.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button></td>
              </tr>
            ))}
            {!ports.length && <tr><td colSpan={5} className="py-4 text-sm text-ink-2">No ports yet. Add RJ45 ports in fours, or one at a time.</td></tr>}
          </tbody>
        </table>
      </div>
      {template && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={keepPositions} onChange={(e) => setKeepPositions(e.target.checked)} /> Keep existing port positions (when the port count is unchanged)</label>}
      <div className="mt-6 flex justify-between">
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
