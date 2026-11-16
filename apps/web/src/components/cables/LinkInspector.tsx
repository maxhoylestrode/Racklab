import { useEffect, useState } from 'react';
import { CABLE_TYPES, type CableType } from '@rackmap/shared';
import { useLab } from '../../store/lab';
import { toast } from '../../store/toast';
import { confirmDialog } from '../ui';
import { Icon } from '../Icon';

const SWATCHES = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#e5e7eb', '#111827'];

/** Small floating inspector for the selected cable: type, colour, length, label, notes, delete. */
export function LinkInspector({ linkId }: { linkId: string }) {
  const { links, devices, updateLink, deleteLink, select } = useLab();
  const link = links.find((l) => l.id === linkId);
  const [label, setLabel] = useState(link?.label ?? '');
  const [notes, setNotes] = useState(link?.notes ?? '');
  const [length, setLength] = useState(link?.length_m?.toString() ?? '');
  useEffect(() => { setLabel(link?.label ?? ''); setNotes(link?.notes ?? ''); setLength(link?.length_m?.toString() ?? ''); }, [link?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!link) return null;
  const end = (portId: string) => {
    for (const d of devices) {
      const p = d.ports.find((x) => x.id === portId);
      if (p) return { d, p };
    }
    return null;
  };
  const a = end(link.port_a_id), b = end(link.port_b_id);
  const save = (patch: Parameters<typeof updateLink>[1]) => updateLink(link.id, patch).catch(toast.error);
  return (
    <aside className="card no-print absolute bottom-4 right-4 z-30 w-80 p-4 shadow-2xl" aria-label="Cable inspector">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: link.cable_color }} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Cable</div>
          <div className="truncate text-xs text-slate-500">{a?.d.name} {a?.p.label} → {b?.d.name} {b?.p.label}</div>
        </div>
        <button className="btn btn-ghost btn-sm" aria-label="Close cable inspector" onClick={() => select(null)}><Icon name="close" size={13} /></button>
      </div>
      {a?.p.speed_mbps && b?.p.speed_mbps && a.p.speed_mbps !== b.p.speed_mbps && (
        <p className="mb-3 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-300"><Icon name="warning" size={12} /> Speed mismatch: {a.p.speed_mbps} vs {b.p.speed_mbps} Mbps</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Type</span>
          <select className="input py-1" value={link.cable_type} onChange={(e) => void save({ cable_type: e.target.value as CableType })}>
            {CABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label><span className="label">Length (m)</span>
          <input className="input py-1" type="number" min={0} step={0.1} value={length} onChange={(e) => setLength(e.target.value)}
            onBlur={() => { const v = length ? Number(length) : null; if (v !== link.length_m) void save({ length_m: v && v > 0 ? v : null }); }} />
        </label>
      </div>
      <div className="mt-2">
        <span className="label">Colour</span>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cable colour">
          {SWATCHES.map((c) => (
            <button key={c} role="radio" aria-checked={link.cable_color === c} aria-label={c} onClick={() => void save({ cable_color: c })}
              className={`h-6 w-6 rounded-full border-2 ${link.cable_color === c ? 'border-sky-400' : 'border-transparent'}`} style={{ background: c }} />
          ))}
          <input type="color" value={link.cable_color} onChange={(e) => void save({ cable_color: e.target.value })} aria-label="Custom colour" className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
        </div>
      </div>
      <label className="mt-2 block"><span className="label">Label</span>
        <input className="input py-1" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if ((label || null) !== link.label) void save({ label: label || null }); }} />
      </label>
      <label className="mt-2 block"><span className="label">Notes</span>
        <textarea className="input py-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if ((notes || null) !== link.notes) void save({ notes: notes || null }); }} />
      </label>
      <button className="btn btn-danger btn-sm mt-3 w-full" onClick={async () => {
        if (await confirmDialog({ title: 'Delete cable?', message: 'Remove this cable? You can undo with Ctrl+Z.', danger: true, confirmLabel: 'Delete' })) {
          await deleteLink(link.id).catch(toast.error);
        }
      }}><Icon name="trash" size={13} /> Delete cable</button>
    </aside>
  );
}
