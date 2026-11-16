import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEVICE_STATUSES, type DeviceStatus, type Rack } from '@rackmap/shared';
import { useLab, placementOf } from '../store/lab';
import { useUi, UNIT_MIN, UNIT_MAX } from '../store/ui';
import { toast } from '../store/toast';
import { api } from '../lib/api';
import { RackScene } from '../components/rack/RackScene';
import { Library } from '../components/rack/Library';
import { DeviceDrawer } from '../components/drawer/DeviceDrawer';
import { Cables, useWiring } from '../components/cables/Cables';
import { LinkInspector } from '../components/cables/LinkInspector';
import { confirmDialog, Empty, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { exportPng, exportSvg } from '../lib/exportRack';

export function RackPage() {
  const lab = useLab();
  const { racks, devices, templates, links, rackId, selection, select, load, loaded } = lab;
  const ui = useUi();
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [changeTpl, setChangeTpl] = useState<string | null>(null);
  const [newRack, setNewRack] = useState(false);
  const wiring = useWiring();

  useEffect(() => { void load().catch(toast.error); }, [load]);

  const rack = racks.find((r) => r.id === rackId);
  const selectedDevice = selection?.kind === 'device' ? devices.find((d) => d.id === selection.id) : undefined;

  // Search highlights matches; "dim unrelated" fades everything except the selection and its neighbours.
  const neighbours = useMemo(() => {
    if (!selectedDevice) return null;
    const mine = new Set(selectedDevice.ports.map((p) => p.id));
    const owner = new Map(devices.flatMap((d) => d.ports.map((p) => [p.id, d.id] as const)));
    const s = new Set<string>([selectedDevice.id]);
    for (const l of links) {
      if (mine.has(l.port_a_id)) s.add(owner.get(l.port_b_id)!);
      if (mine.has(l.port_b_id)) s.add(owner.get(l.port_a_id)!);
    }
    // A shelf's riders count as related to the shelf.
    for (const d of devices) if (d.shelf_device_id === selectedDevice.id) s.add(d.id);
    return s;
  }, [selectedDevice, devices, links]);
  const q = ui.search.trim().toLowerCase();
  const dimmed = useCallback((id: string) => {
    if (q) {
      const d = devices.find((x) => x.id === id);
      const hay = `${d?.name} ${d?.hostname ?? ''} ${d?.role ?? ''} ${d?.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return true;
    }
    if (ui.dimUnrelated && neighbours) return !neighbours.has(id);
    return false;
  }, [q, devices, ui.dimUnrelated, neighbours]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
      const mod = e.ctrlKey || e.metaKey;
      try {
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); await (e.shiftKey ? lab.redo() : lab.undo()); return; }
        if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); await lab.redo(); return; }
        if (e.key === 'Escape') {
          if (wiring.pending) wiring.cancel();
          else if (ui.wireMode) ui.setWireMode(false);
          else select(null);
          return;
        }
        if (selection?.kind === 'link' && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          if (await confirmDialog({ title: 'Delete cable?', message: 'Remove this cable?', danger: true, confirmLabel: 'Delete' })) await lab.deleteLink(selection.id);
          return;
        }
        if (!selectedDevice) return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          await deleteWithConfirm(selectedDevice.id);
        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedDevice.rack_unit_start && selectedDevice.rack_id) {
          e.preventDefault();
          const to = selectedDevice.rack_unit_start + (e.key === 'ArrowUp' ? 1 : -1);
          await lab.moveDevice(selectedDevice.id, { ...placementOf(selectedDevice), rack_unit_start: to });
        } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selectedDevice.shelf_device_id) {
          e.preventDefault();
          const to = (selectedDevice.shelf_slot ?? 1) + (e.key === 'ArrowRight' ? 1 : -1);
          await lab.moveDevice(selectedDevice.id, { ...placementOf(selectedDevice), shelf_slot: to });
        } else if (e.key === 'F2') {
          e.preventDefault();
          setRenaming(selectedDevice.id);
        }
      } catch (err) {
        shake(selectedDevice?.id);
        toast.error(err);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shake = (id?: string) => {
    if (!id) return;
    const el = svgRef.current?.querySelector(`[data-device-id="${id}"]`);
    el?.classList.remove('shake');
    void (el as SVGGraphicsElement | null)?.getBBox?.();
    el?.classList.add('shake');
    setTimeout(() => el?.classList.remove('shake'), 400);
  };

  async function deleteWithConfirm(id: string) {
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    const riders = devices.filter((x) => x.shelf_device_id === id).length;
    const ok = await confirmDialog({
      title: `Delete ${d.name}?`,
      message: <>This removes the device with its ports, cables, IPs, services, notes and credentials.{riders > 0 && <> The {riders} device{riders === 1 ? '' : 's'} on it move to the unracked tray.</>} You can undo with Ctrl+Z.</>,
      danger: true,
      confirmLabel: 'Delete device',
    });
    if (ok) { await lab.deleteDevice(id); void lab.refreshBadges(); }
  }

  if (!loaded) return <div className="p-6 text-sm text-slate-500">Loading lab…</div>;

  return (
    <div className="flex h-full">
      <Library />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/60 px-3 py-2 dark:border-slate-800 dark:bg-[#0d121c]/60" role="toolbar" aria-label="Rack tools">
          <label className="sr-only" htmlFor="rack-select">Rack</label>
          <select id="rack-select" className="input w-auto py-1" value={rackId ?? ''} onChange={(e) => lab.setRack(e.target.value)}>
            {racks.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.total_units}U)</option>)}
            {!racks.length && <option value="">No racks</option>}
          </select>
          <button className="btn btn-sm" onClick={() => setNewRack(true)} aria-label="New rack" title="New rack"><Icon name="plus" size={13} /></button>
          <div className="flex items-center gap-1" aria-label="Zoom">
            <button className="btn btn-ghost btn-sm" aria-label="Zoom out" onClick={() => ui.setUnitPx(ui.unitPx - 6)}><Icon name="minus" size={13} /></button>
            <input type="range" min={UNIT_MIN} max={UNIT_MAX} value={ui.unitPx} onChange={(e) => ui.setUnitPx(Number(e.target.value))} aria-label="Unit height" className="w-24 accent-sky-500" />
            <button className="btn btn-ghost btn-sm" aria-label="Zoom in" onClick={() => ui.setUnitPx(ui.unitPx + 6)}><Icon name="plus" size={13} /></button>
          </div>
          <div className="flex rounded-md border border-slate-300 p-0.5 dark:border-slate-700" role="group" aria-label="View">
            <button className="btn btn-sm btn-on border-0" aria-pressed="true">Rack</button>
            <button className="btn btn-ghost btn-sm border-0" aria-pressed="false" onClick={() => navigate('/topology')}>Topology</button>
          </div>
          <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
          <button className={`btn btn-sm ${ui.wireMode ? 'btn-on' : ''}`} aria-pressed={ui.wireMode} onClick={() => { ui.setWireMode(!ui.wireMode); wiring.cancel(); }} title="Wire mode: click a port, then another port">
            <Icon name="cable" size={14} /> Wire
          </button>
          <button className={`btn btn-sm ${ui.showCables ? 'btn-on' : ''}`} aria-pressed={ui.showCables} onClick={() => ui.toggle('showCables')}>Show cables</button>
          <button className={`btn btn-sm ${ui.dimUnrelated ? 'btn-on' : ''}`} aria-pressed={ui.dimUnrelated} onClick={() => ui.toggle('dimUnrelated')}>Dim unrelated</button>
          <button className={`btn btn-sm ${ui.showBadges ? 'btn-on' : ''}`} aria-pressed={ui.showBadges} onClick={() => ui.toggle('showBadges')}>Project badges</button>
          <div className="flex-1" />
          <button className="btn btn-ghost btn-sm" disabled={!lab.past.length} onClick={() => lab.undo().catch(toast.error)} aria-label="Undo" title={lab.past.at(-1) ? `Undo: ${lab.past.at(-1)!.label}` : 'Undo'}><Icon name="undo" size={14} /></button>
          <button className="btn btn-ghost btn-sm" disabled={!lab.future.length} onClick={() => lab.redo().catch(toast.error)} aria-label="Redo" title={lab.future.at(-1) ? `Redo: ${lab.future.at(-1)!.label}` : 'Redo'}><Icon name="redo" size={14} /></button>
          <ExportMenu svgRef={svgRef} name={rack?.name ?? 'rack'} />
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input w-44 py-1 pl-7" placeholder="Search devices" value={ui.search} onChange={(e) => ui.setSearch(e.target.value)} aria-label="Search devices" />
          </div>
        </div>
        {ui.wireMode && (
          <div className="no-print border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300" role="status">
            {wiring.pending ? 'Now click the port at the other end. Escape cancels.' : 'Wire mode: click a port to start a cable.'}
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-auto" onClick={() => setMenu(null)}>
          {!rack ? (
            <div className="p-8"><Empty title="No rack yet" action={<button className="btn btn-primary" onClick={() => setNewRack(true)}>Create a rack</button>}>Create a rack, then drag devices from the library on the left.</Empty></div>
          ) : (
            <div className="flex min-w-max justify-center p-6">
              <RackScene
                rack={rack}
                devices={devices}
                templates={templates}
                links={links}
                svgRef={svgRef}
                dimmed={dimmed}
                renaming={renaming}
                setRenaming={setRenaming}
                onContextMenu={(id, x, y) => setMenu({ id, x, y })}
                overlay={(sceneApi) => <Cables scene={sceneApi} dimmed={dimmed} />}
              />
            </div>
          )}
          {rack && devices.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-lg bg-slate-900/90 px-4 py-2 text-sm text-slate-200 shadow-lg">
              Empty rack. Drag a switch or server from the library on the left to get started.
            </div>
          )}
        </div>
      </div>

      <DeviceDrawer />
      {selection?.kind === 'link' && <LinkInspector linkId={selection.id} />}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', run: () => setRenaming(menu.id) },
            { label: 'Duplicate', run: async () => { const d = await lab.duplicateDevice(menu.id); select({ kind: 'device', id: d.id }); } },
            { label: 'Change template…', run: () => setChangeTpl(menu.id) },
            ...DEVICE_STATUSES.map((s) => ({ label: `Set status: ${s}`, run: () => lab.setStatus(menu.id, s as DeviceStatus) })),
            { label: 'Delete…', danger: true, run: () => deleteWithConfirm(menu.id) },
          ]}
        />
      )}
      {changeTpl && <ChangeTemplate deviceId={changeTpl} onClose={() => setChangeTpl(null)} />}
      <NewRackDialog open={newRack} onClose={() => setNewRack(false)} />
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; onClose: () => void; items: { label: string; run: () => unknown; danger?: boolean }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const bs = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        const i = bs.indexOf(document.activeElement as HTMLElement);
        bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="card fixed z-50 w-52 py-1 text-sm shadow-xl" style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 300) }}>
      {items.map((it) => (
        <button key={it.label} role="menuitem" className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800 ${it.danger ? 'text-rose-500' : ''}`}
          onClick={async () => { onClose(); try { await it.run(); } catch (e) { toast.error(e); } }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ChangeTemplate({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const { devices, templates, updateDevice } = useLab();
  const d = devices.find((x) => x.id === deviceId);
  const [tid, setTid] = useState(d?.template_id ?? '');
  if (!d) return null;
  return (
    <Modal open onClose={onClose} title={`Change template: ${d.name}`}>
      <select className="input" value={tid} onChange={(e) => setTid(e.target.value)} aria-label="Template">
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.form_factor === 'rack' ? `${t.height_u}U` : 'loose'})</option>)}
      </select>
      <p className="mt-2 text-xs text-slate-500">Ports with the same label keep their cables. Other ports and their cables are removed.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={async () => { try { await updateDevice(d.id, { template_id: tid }); onClose(); } catch (e) { toast.error(e); } }}>Change</button>
      </div>
    </Modal>
  );
}

function NewRackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('New rack');
  const [units, setUnits] = useState(42);
  return (
    <Modal open={open} onClose={onClose} title="New rack">
      <form onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await api.post<Rack>('/racks', { name, total_units: units });
          useLab.setState((s) => ({ racks: [...s.racks, r], rackId: r.id }));
          onClose();
        } catch (err) { toast.error(err); }
      }}>
        <label className="label" htmlFor="rack-name">Name</label>
        <input id="rack-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label mt-3" htmlFor="rack-units">Height (U)</label>
        <input id="rack-units" type="number" min={1} max={60} className="input" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Create</button></div>
      </form>
    </Modal>
  );
}

function ExportMenu({ svgRef, name }: { svgRef: React.MutableRefObject<SVGSVGElement | null>; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Export the rack view"><Icon name="image" size={14} /></button>
      {open && (
        <div role="menu" className="card absolute right-0 top-8 z-40 w-40 py-1 text-sm">
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setOpen(false); if (svgRef.current) void exportPng(svgRef.current, name).catch(toast.error); }}>Export PNG</button>
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setOpen(false); if (svgRef.current) exportSvg(svgRef.current, name); }}>Export SVG</button>
        </div>
      )}
    </div>
  );
}
