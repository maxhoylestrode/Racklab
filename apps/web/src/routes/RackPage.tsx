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
import { IconButton, SearchInput, Tooltip, Actions } from '../components/primitives';

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-line-strong" aria-hidden />;
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

  if (!loaded) return <div className="p-6 text-sm text-ink-2">Loading lab…</div>;

  return (
    <div className="relative flex h-full flex-col gap-2 md:flex-row">
      <h1 className="sr-only">Rack: {rack?.name ?? 'no rack'}</h1>
      <Library />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {/* toolbar */}
        <div className="rack-toolbar glass no-print flex h-12 shrink-0 items-center gap-2 overflow-x-auto rounded-panel px-2" role="toolbar" aria-label="Rack tools">
          <label className="sr-only" htmlFor="rack-select">Rack</label>
          <select id="rack-select" className="input w-auto max-w-[200px] shrink-0" value={rackId ?? ''} onChange={(e) => lab.setRack(e.target.value)}>
            {racks.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.total_units}U)</option>)}
            {!racks.length && <option value="">No racks</option>}
          </select>
          <IconButton icon="plus" label="New rack" variant="secondary" size="md" onClick={() => setNewRack(true)} />
          <Divider />
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
            <IconButton icon="minus" label="Zoom out" onClick={() => ui.setUnitPx(ui.unitPx - 6)} />
            <input type="range" min={UNIT_MIN} max={UNIT_MAX} value={ui.unitPx} onChange={(e) => ui.setUnitPx(Number(e.target.value))} aria-label="Unit height" className="tb-optional w-16" />
            <IconButton icon="plus" label="Zoom in" onClick={() => ui.setUnitPx(ui.unitPx + 6)} />
          </div>
          <Divider />
          <Tooltip content="Click a port, then another port">
            <button className={`btn btn-sm shrink-0 ${ui.wireMode ? 'btn-on' : ''}`} aria-pressed={ui.wireMode} onClick={() => { ui.setWireMode(!ui.wireMode); wiring.cancel(); }}>
              <Icon name="cable" /> Wire
            </button>
          </Tooltip>
          <div className="segmented shrink-0" role="group" aria-label="Layers">
            <Tooltip content="Show cables"><button className="btn" aria-pressed={ui.showCables} aria-label="Show cables" onClick={() => ui.toggle('showCables')}><Icon name="cables" /></button></Tooltip>
            <Tooltip content="Dim unrelated devices"><button className="btn" aria-pressed={ui.dimUnrelated} aria-label="Dim unrelated" onClick={() => ui.toggle('dimUnrelated')}><Icon name="dim" /></button></Tooltip>
            <Tooltip content="Project badges"><button className="btn" aria-pressed={ui.showBadges} aria-label="Project badges" onClick={() => ui.toggle('showBadges')}><Icon name="badge" /></button></Tooltip>
          </div>
          <div className="segmented hidden shrink-0 2xl:inline-flex" role="group" aria-label="View">
            <button className="btn" aria-pressed="true">Rack</button>
            <button className="btn" aria-pressed="false" onClick={() => navigate('/topology')}>Topology</button>
          </div>
          <div className="min-w-2 flex-1" />
          <IconButton icon="undo" label="Undo" tooltip={lab.past.at(-1) ? `Undo: ${lab.past.at(-1)!.label}` : 'Undo'} disabled={!lab.past.length} onClick={() => lab.undo().catch(toast.error)} />
          <IconButton icon="redo" label="Redo" tooltip={lab.future.at(-1) ? `Redo: ${lab.future.at(-1)!.label}` : 'Redo'} disabled={!lab.future.length} onClick={() => lab.redo().catch(toast.error)} />
          <ExportMenu svgRef={svgRef} name={rack?.name ?? 'rack'} />
          <SearchInput wrapperClassName="shrink-0" className="w-36 transition-[width] duration-base focus:w-52" placeholder="Search devices" value={ui.search} onChange={(e) => ui.setSearch(e.target.value)} aria-label="Search devices" />
        </div>
        <div className="relative min-h-0 flex-1">
        {ui.wireMode && (
          <div className="glass glass-overlay no-print pointer-events-none absolute left-1/2 top-3 z-overlay-ui flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full py-1 pl-2 pr-3 text-xs text-ink" role="status">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
            {wiring.pending ? 'Now click the port at the other end. Esc cancels.' : 'Wire mode: click a port to start a cable. Esc exits.'}
          </div>
        )}
        <div className="h-full overflow-auto" onClick={() => setMenu(null)}>
          {!rack ? (
            <div className="p-8"><Empty title="No rack yet" action={<button className="btn btn-primary" onClick={() => setNewRack(true)}><Icon name="plus" />Create a rack</button>}>Create a rack, then drag devices onto it from the library.</Empty></div>
          ) : (
            <div className="flex min-w-max justify-center px-6 pb-8 pt-4">
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
            <div className="glass glass-overlay pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-panel px-4 py-2 text-sm text-ink">
              Empty rack. Drag a switch or server from the library to get started.
            </div>
          )}
        </div>
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
            ...DEVICE_STATUSES.map((s, i) => ({ label: `Set status: ${s}`, sep: i === 0, run: () => lab.setStatus(menu.id, s as DeviceStatus) })),
            { label: 'Delete…', danger: true, sep: true, run: () => deleteWithConfirm(menu.id) },
          ]}
        />
      )}
      {changeTpl && <ChangeTemplate deviceId={changeTpl} onClose={() => setChangeTpl(null)} />}
      <NewRackDialog open={newRack} onClose={() => setNewRack(false)} />
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; onClose: () => void; items: { label: string; run: () => unknown; danger?: boolean; sep?: boolean }[] }) {
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
    <div ref={ref} role="menu" className="menu fixed w-56" style={{ left: Math.min(x, window.innerWidth - 232), top: Math.min(y, window.innerHeight - 360) }}>
      {items.map((it, i) => (
        <button key={it.label} role="menuitem" className={`menu-item ${it.danger ? 'menu-item-danger' : ''} ${it.sep ? 'mt-1 border-t border-line' : ''} ${i === 0 ? '' : ''}`}
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
      <p className="mt-2 text-xs text-ink-2">Ports with the same label keep their cables. Other ports and their cables are removed.</p>
      <Actions>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={async () => { try { await updateDevice(d.id, { template_id: tid }); onClose(); } catch (e) { toast.error(e); } }}>Change</button>
      </Actions>
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
        <label className="label mt-4" htmlFor="rack-units">Height (U)</label>
        <input id="rack-units" type="number" min={1} max={60} className="input" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
        <Actions><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Create rack</button></Actions>
      </form>
    </Modal>
  );
}

function ExportMenu({ svgRef, name }: { svgRef: React.MutableRefObject<SVGSVGElement | null>; name: string }) {
  const [at, setAt] = useState<{ right: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAt(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [at]);
  return (
    <div ref={ref}>
      <IconButton icon="image" label="Export the rack view" aria-haspopup="menu" aria-expanded={!!at}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(at ? null : { right: window.innerWidth - r.right, top: r.bottom + 6 }); }} />
      {/* Fixed position: the toolbar scrolls horizontally on small screens and would clip an absolute menu. */}
      {at && (
        <div role="menu" className="menu fixed w-44" style={at}>
          <button role="menuitem" className="menu-item" onClick={() => { setAt(null); if (svgRef.current) void exportPng(svgRef.current, name).catch(toast.error); }}><Icon name="download" className="text-ink-2" />Export PNG</button>
          <button role="menuitem" className="menu-item" onClick={() => { setAt(null); if (svgRef.current) exportSvg(svgRef.current, name); }}><Icon name="download" className="text-ink-2" />Export SVG</button>
        </div>
      )}
    </div>
  );
}

