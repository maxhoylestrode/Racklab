import { useEffect, useState } from 'react';
import { DEVICE_STATUSES, type Device, type DeviceStatus, type DeviceTemplate, type Project } from '@rackmap/shared';
import { useLab } from '../../store/lab';
import { toast } from '../../store/toast';
import { useFetch } from '../../lib/useFetch';
import { DeviceThumb } from '../../illustrations';
import { NewProjectDialog } from '../projects/NewProjectDialog';
import { ProjectDrawer } from '../projects/ProjectDrawer';
import { Icon } from '../Icon';

function Field({ label, value, onSave, placeholder }: { label: string; value: string | null; onSave: (v: string | null) => void; placeholder?: string }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const id = `f-${label.replace(/\W/g, '')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
        onBlur={() => { const nv = v.trim() || null; if (nv !== value) onSave(nv); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

export function OverviewTab({ device, tpl }: { device: Device; tpl: DeviceTemplate }) {
  const { updateDevice, racks, devices } = useLab();
  const save = (patch: Parameters<typeof updateDevice>[1]) => updateDevice(device.id, patch).catch(toast.error);
  const [tags, setTags] = useState(device.tags.join(', '));
  useEffect(() => setTags(device.tags.join(', ')), [device.tags]);
  const rack = racks.find((r) => r.id === device.rack_id);
  const shelf = devices.find((d) => d.id === device.shelf_device_id);
  const position = device.rack_unit_start && rack
    ? `${rack.name}, U${device.rack_unit_start}${tpl.height_u > 1 ? ` to U${device.rack_unit_start + tpl.height_u - 1}` : ''}`
    : shelf ? `${shelf.name}, slot ${device.shelf_slot}` : 'Unracked tray';

  return (
    <div className="space-y-4">
      <div className="surface-inset flex justify-center rounded-panel px-4 py-6"><DeviceThumb device={device} tpl={tpl} width={tpl.form_factor === 'loose' ? 180 : 340} /></div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <div className="col-span-2"><Field label="Name" value={device.name} onSave={(v) => v && save({ name: v })} /></div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" className="input" value={device.status} onChange={(e) => void save({ status: e.target.value as DeviceStatus })}>
            {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <span className="label">Template</span>
          <p className="flex h-8 items-center truncate text-sm text-ink">{tpl.name}</p>
        </div>
        <Field label="Hostname" value={device.hostname} onSave={(v) => save({ hostname: v })} />
        <Field label="Role" value={device.role} onSave={(v) => save({ role: v })} />
        <Field label="OS" value={device.os} onSave={(v) => save({ os: v })} />
        <div>
          <label className="label" htmlFor="f-accent">Accent colour</label>
          <div className="flex items-center gap-2">
            <input id="f-accent" type="color" value={device.color_accent ?? '#7f8ea3'} onChange={(e) => void save({ color_accent: e.target.value })} />
            {device.color_accent && <button className="btn btn-ghost btn-sm" onClick={() => void save({ color_accent: null })}>Clear</button>}
          </div>
        </div>
        <div className="col-span-2"><Field label="Location note" value={device.location_note} onSave={(v) => save({ location_note: v })} /></div>
        <div className="col-span-2">
          <label className="label" htmlFor="f-tags">Tags</label>
          <input id="f-tags" className="input" value={tags} placeholder="comma separated" onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const next = [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))];
              if (next.join(',') !== device.tags.join(',')) void save({ tags: next });
            }} />
        </div>
        <div className="col-span-2">
          <span className="label">Rack position</span>
          <p className="text-sm text-ink">{position}</p>
        </div>
      </div>
      <DeviceProjects device={device} />
    </div>
  );
}

function DeviceProjects({ device }: { device: Device }) {
  const { data, reload } = useFetch<Project[]>(`/projects?device_id=${device.id}&open=true`, [device.id]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const refreshBadges = useLab((s) => s.refreshBadges);
  return (
    <section aria-labelledby="dev-projects" className="border-t border-line pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 id="dev-projects" className="text-sm font-medium">Projects</h3>
        <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" /> Add project</button>
      </div>
      {!data?.length && <p className="text-sm text-ink-2">No open projects for this device or its services.</p>}
      <ul className="-mx-2">
        {data?.map((p) => (
          <li key={p.id}>
            <button className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-ink transition-colors duration-fast hover:bg-surface-hover" onClick={() => setOpen(p.id)}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${p.status === 'in_progress' ? 'bg-accent' : 'bg-unknown'}`} aria-hidden />
              <span className="flex-1 truncate">{p.title}</span>
              <span className="text-xs text-ink-2">{p.status === 'in_progress' ? 'In progress' : 'Not started'}</span>
            </button>
          </li>
        ))}
      </ul>
      {adding && <NewProjectDialog presetLink={{ device_id: device.id }} onClose={() => setAdding(false)} onCreated={() => { void reload(); void refreshBadges(); }} />}
      {open && <ProjectDrawer projectId={open} onClose={() => { setOpen(null); void reload(); void refreshBadges(); }} overlay />}
    </section>
  );
}
