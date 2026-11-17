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
    <aside className="panel panel-overlay no-print absolute bottom-2 right-2 z-drawer w-80 max-w-[calc(100%-16px)] rounded-panel p-4" aria-label="Cable inspector">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-white/20" style={{ background: link.cable_color }} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium text-ink">Cable</div>
          <div className="mt-1 truncate text-xs text-ink-2">{a?.d.name} <span className="font-mono">{a?.p.label}</span> to {b?.d.name} <span className="font-mono">{b?.p.label}</span></div>
        </div>
        <button className="btn btn-ghost btn-sm" aria-label="Close cable inspector" onClick={() => select(null)}><Icon name="close" size={13} /></button>
      </div>
      {a?.p.speed_mbps && b?.p.speed_mbps && a.p.speed_mbps !== b.p.speed_mbps && (
        <p className="mb-4 flex items-center gap-2 rounded-control border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"><Icon name="warning" /> Speed mismatch: {a.p.speed_mbps} vs {b.p.speed_mbps} Mbps</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label><span className="label">Type</span>
          <select className="input" value={link.cable_type} onChange={(e) => void save({ cable_type: e.target.value as CableType })}>
            {CABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label><span className="label">Length (m)</span>
          <input className="input font-mono" type="number" min={0} step={0.1} value={length} onChange={(e) => setLength(e.target.value)}
            onBlur={() => { const v = length ? Number(length) : null; if (v !== link.length_m) void save({ length_m: v && v > 0 ? v : null }); }} />
        </label>
      </div>
      <div className="mt-3">
        <span className="label">Colour</span>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cable colour">
          {SWATCHES.map((c) => (
            <button key={c} role="radio" aria-checked={link.cable_color === c} aria-label={c} onClick={() => void save({ cable_color: c })}
              className={`h-6 w-6 rounded-full ring-1 ring-inset ring-white/15 transition-shadow duration-fast ${link.cable_color === c ? 'outline outline-2 outline-offset-2 outline-accent' : ''}`} style={{ background: c }} />
          ))}
          <input type="color" value={link.cable_color} onChange={(e) => void save({ cable_color: e.target.value })} aria-label="Custom colour" className="!h-6 !w-8" />
        </div>
      </div>
      <label className="mt-3 block"><span className="label">Label</span>
        <input className="input" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if ((label || null) !== link.label) void save({ label: label || null }); }} />
      </label>
      <label className="mt-3 block"><span className="label">Notes</span>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if ((notes || null) !== link.notes) void save({ notes: notes || null }); }} />
      </label>
      <button className="btn btn-danger mt-4 w-full" onClick={async () => {
        if (await confirmDialog({ title: 'Delete cable?', message: 'Remove this cable? You can undo with Ctrl+Z.', danger: true, confirmLabel: 'Delete' })) {
          await deleteLink(link.id).catch(toast.error);
        }
      }}><Icon name="trash" size={13} /> Delete cable</button>
    </aside>
  );
}
