import { useMemo, useState } from 'react';
import type { Service } from '@rackmap/shared';
import { useLab } from '../../store/lab';
import { useFetch } from '../../lib/useFetch';

export type LinkTarget = { device_id: string } | { service_id: string };

/** Search devices and services by name (for example "CT on the server" -> the R420 or its Proxmox service). */
export function LinkPicker({ onPick, exclude = [], autoFocus }: { onPick: (t: LinkTarget, label: string) => void; exclude?: string[]; autoFocus?: boolean }) {
  const devices = useLab((s) => s.devices);
  const services = useFetch<Service[]>('/services');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !['on', 'the', 'a', 'an', 'in', 'to', 'for'].includes(w));
    const score = (s: string) => (words.length ? words.filter((w) => s.toLowerCase().includes(w)).length : 1);
    const devName = (id: string) => devices.find((d) => d.id === id)?.name ?? '';
    const all = [
      ...devices.filter((d) => d.ports.length > 0 || true).map((d) => ({ key: d.id, label: d.name, sub: 'Device', target: { device_id: d.id } as LinkTarget, hay: `${d.name} ${d.role ?? ''} ${d.hostname ?? ''} ${d.os ?? ''} server device` })),
      ...(services.data ?? []).map((s) => ({ key: s.id, label: s.name, sub: `${s.kind.toUpperCase()}${s.vmid_or_ctid != null ? ` ${s.vmid_or_ctid}` : ''} on ${devName(s.device_id)}`, target: { service_id: s.id } as LinkTarget, hay: `${s.name} ${s.kind} ${s.kind === 'lxc' ? 'ct container' : ''} ${devName(s.device_id)}` })),
    ].filter((x) => !exclude.includes(x.key));
    return all.map((x) => ({ ...x, s: score(x.hay) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.label.localeCompare(b.label)).slice(0, 8);
  }, [q, devices, services.data, exclude]);

  return (
    <div className="relative">
      <input className="input" placeholder="Search devices and services" value={q} autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        role="combobox" aria-expanded={open} aria-controls="link-picker-list" aria-label="Link to" />
      {open && results.length > 0 && (
        <ul id="link-picker-list" role="listbox" className="card absolute z-50 mt-1 max-h-60 w-full overflow-y-auto py-1 text-sm">
          {results.map((r) => (
            <li key={r.key} role="option" aria-selected={false}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(r.target, r.label); setQ(''); setOpen(false); }}>
                <span className="flex-1 truncate">{r.label}</span>
                <span className="text-[11px] text-slate-500">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
