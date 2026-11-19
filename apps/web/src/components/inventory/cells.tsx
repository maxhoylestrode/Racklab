import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DEVICE_STATUSES, type Device, type DeviceStatus } from '@rackmap/shared';
import { useLab, UNPLACED, type Placement } from '../../store/lab';
import { errorMessage } from '../../lib/api';
import { Icon } from '../Icon';
import { Dropdown, PillSelect, STATUS_COLOR } from '../Select';

/**
 * Click or press Enter to edit; Enter saves, Escape cancels, blur saves. `editing` is controlled by the table
 * so the E shortcut can open the name editor of the active row.
 */
export function EditableText({ value, display, label, editing, setEditing, onSave, mono, placeholder, className = '' }: {
  value: string; display?: ReactNode; label: string; editing: boolean; setEditing: (on: boolean) => void;
  onSave: (v: string) => Promise<unknown> | void; mono?: boolean; placeholder?: string; className?: string;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { if (editing) { setV(value); done.current = false; requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); }); } }, [editing, value]);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save && v.trim() !== value) void onSave(v.trim());
  };
  if (editing) {
    return (
      <input ref={ref} className={`input h-7 px-2 text-sm ${mono ? 'font-mono' : ''}`} style={{ height: 28 }} value={v} aria-label={label} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)} />
    );
  }
  return (
    <button type="button" data-cell aria-label={`${label}: ${value || 'empty'}. Press Enter to edit`}
      className={`-mx-1 flex h-6 max-w-full items-center rounded-sm px-1 text-left hover:bg-surface-hover hover:shadow-[0_0_0_1px_var(--line-strong)] ${mono ? 'font-mono' : ''} ${className}`}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setEditing(true); } }}>
      {display ?? (value ? <span className="truncate">{value}</span> : <span className="whitespace-nowrap text-ink-2"><span aria-hidden className="group-hover:hidden">–</span><span className="hidden group-hover:inline">{placeholder ?? 'Add'}</span></span>)}
    </button>
  );
}

/** Status as an inline dropdown chip. */
export function StatusSelect({ device, onChange }: { device: Device; onChange: (s: DeviceStatus) => void }) {
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <PillSelect size="sm" label={`Status of ${device.name}`} value={device.status} onChange={(v) => onChange(v as DeviceStatus)}
        options={DEVICE_STATUSES.map((s) => ({ value: s, label: s, color: STATUS_COLOR[s] }))} />
    </span>
  );
}

/**
 * Rack position picker: rack and unit, shelf and slot, or unracked. Saves through moveDevice, so the server's
 * collision rules apply and its error message is shown here and as a toast.
 */
export function PositionPicker({ device, anchor, onClose, onMove }: {
  device: Device; anchor: DOMRect; onClose: () => void; onMove: (p: Placement) => Promise<void>;
}) {
  const { racks, devices, templates } = useLab();
  const tpl = templates.find((t) => t.id === device.template_id);
  const shelves = devices.filter((d) => templates.find((t) => t.id === d.template_id)?.category === 'shelf' && d.id !== device.id);
  const loose = tpl?.form_factor === 'loose';
  const [mode, setMode] = useState<'rack' | 'shelf' | 'none'>(device.rack_unit_start ? 'rack' : device.shelf_device_id ? 'shelf' : loose ? 'shelf' : 'rack');
  const [rackId, setRackId] = useState(device.rack_id ?? racks[0]?.id ?? '');
  const [unit, setUnit] = useState(String(device.rack_unit_start ?? ''));
  const [shelfId, setShelfId] = useState(device.shelf_device_id ?? shelves[0]?.id ?? '');
  const [slot, setSlot] = useState(String(device.shelf_slot ?? 1));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const slots = templates.find((t) => t.id === devices.find((d) => d.id === shelfId)?.template_id)?.shelf_slots ?? 2;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, input')?.focus();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  const apply = async () => {
    setErr(''); setBusy(true);
    const p: Placement = mode === 'rack' ? { ...UNPLACED, rack_id: rackId, rack_unit_start: Number(unit) }
      : mode === 'shelf' ? { ...UNPLACED, shelf_device_id: shelfId, shelf_slot: Number(slot) } : UNPLACED;
    try { await onMove(p); onClose(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 260);
  const left = Math.min(anchor.left, window.innerWidth - 300);
  return createPortal(
    <div ref={ref} role="dialog" aria-label={`Move ${device.name}`} className="panel panel-overlay fixed z-popover w-[288px] rounded-panel p-3" style={{ top, left }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && !busy) { e.preventDefault(); void apply(); } }}>
      <p className="mb-3 text-sm font-medium text-ink">Move {device.name}</p>
      <div className="segmented mb-3 w-full" role="group" aria-label="Placement">
        {(['rack', 'shelf', 'none'] as const).map((m) => (
          <button key={m} type="button" className="btn flex-1" aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'rack' ? 'Rack unit' : m === 'shelf' ? 'Shelf' : 'Unracked'}</button>
        ))}
      </div>
      {mode === 'rack' && (
        <div className="grid grid-cols-[1fr_80px] gap-2">
          <label><span className="label">Rack</span>
            <Dropdown label="Rack" value={rackId} onChange={setRackId} options={racks.map((r) => ({ value: r.id, label: r.name }))} />
          </label>
          <label><span className="label">Bottom U</span><input className="input font-mono" type="number" min={1} value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
        </div>
      )}
      {mode === 'shelf' && (shelves.length ? (
        <div className="grid grid-cols-[1fr_80px] gap-2">
          <label><span className="label">Shelf</span>
            <Dropdown label="Shelf" value={shelfId} onChange={setShelfId} options={shelves.map((s) => ({ value: s.id, label: s.name }))} />
          </label>
          <label><span className="label">Slot</span>
            <Dropdown label="Slot" className="font-mono" value={String(slot)} onChange={setSlot} options={Array.from({ length: slots }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
          </label>
        </div>
      ) : <p className="text-sm text-ink-2">No shelves yet. Add a shelf to a rack first.</p>)}
      {mode === 'none' && <p className="text-sm text-ink-2">The device goes to the unracked tray. Its cables stay.</p>}
      {err && <p className="mt-3 flex items-start gap-2 rounded-sm border border-bad/30 bg-bad/5 px-2 py-1 text-xs text-bad" role="alert"><Icon name="warning" className="mt-px shrink-0" />{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || (mode === 'rack' && (!rackId || !unit)) || (mode === 'shelf' && !shelfId)} onClick={() => void apply()}>Move</button>
      </div>
    </div>,
    document.getElementById('main') ?? document.body,
  );
}
