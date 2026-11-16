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
      <div className="flex justify-center rounded-lg bg-[#0b0f17] p-3"><DeviceThumb device={device} tpl={tpl} width={tpl.form_factor === 'loose' ? 180 : 340} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name" value={device.name} onSave={(v) => v && save({ name: v })} /></div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" className="input" value={device.status} onChange={(e) => void save({ status: e.target.value as DeviceStatus })}>
            {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <span className="label">Template</span>
          <p className="truncate py-1.5 text-sm">{tpl.name}</p>
        </div>
        <Field label="Hostname" value={device.hostname} onSave={(v) => save({ hostname: v })} />
        <Field label="Role" value={device.role} onSave={(v) => save({ role: v })} />
        <Field label="OS" value={device.os} onSave={(v) => save({ os: v })} />
        <div>
          <label className="label" htmlFor="f-accent">Accent colour</label>
          <div className="flex items-center gap-2">
            <input id="f-accent" type="color" className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-transparent dark:border-slate-700" value={device.color_accent ?? '#38bdf8'} onChange={(e) => void save({ color_accent: e.target.value })} />
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
          <p className="text-sm">{position}</p>
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
    <section aria-labelledby="dev-projects" className="border-t border-slate-200 pt-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 id="dev-projects" className="text-sm font-semibold">Projects</h3>
        <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Add project</button>
      </div>
      {!data?.length && <p className="text-xs text-slate-500">No open projects linked to this device or its services.</p>}
      <ul className="space-y-1">
        {data?.map((p) => (
          <li key={p.id}>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setOpen(p.id)}>
              <span className={`h-2 w-2 rounded-full ${p.status === 'in_progress' ? 'bg-sky-500' : 'bg-slate-400'}`} />
              <span className="flex-1 truncate">{p.title}</span>
              <span className="text-[11px] text-slate-500">{p.status === 'in_progress' ? 'In progress' : 'Not started'}</span>
            </button>
          </li>
        ))}
      </ul>
      {adding && <NewProjectDialog presetLink={{ device_id: device.id }} onClose={() => setAdding(false)} onCreated={() => { void reload(); void refreshBadges(); }} />}
      {open && <ProjectDrawer projectId={open} onClose={() => { setOpen(null); void reload(); void refreshBadges(); }} overlay />}
    </section>
  );
}
