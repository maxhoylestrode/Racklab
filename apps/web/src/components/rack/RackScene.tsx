import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Device, DeviceTemplate, Link, Rack } from '@rackmap/shared';
import { RackDefs } from '../../illustrations/defs';
import { DeviceArt } from '../../illustrations';
import { RackFrame, TrayPanel } from './RackFrame';
import { geometry, layout, jackSize, type Geometry, type Placed } from './geometry';
import { resolveDrop, targetToPlacement, type DropTarget } from './dropTarget';
import { useLab } from '../../store/lab';
import { useUi } from '../../store/ui';
import { toast } from '../../store/toast';
import { ApiError } from '../../lib/api';

/** Template currently being dragged from the library (dataTransfer is unreadable during dragover). */
export const libraryDrag: { templateId: string | null } = { templateId: null };

export interface SceneApi {
  g: Geometry;
  placed: Placed[];
  svg: SVGSVGElement | null;
}

interface Props {
  rack: Rack | undefined;
  devices: Device[];
  templates: DeviceTemplate[];
  links: Link[];
  /** Extra layers drawn above devices (cables, port targets). */
  overlay?: (api: SceneApi) => ReactNode;
  onContextMenu: (deviceId: string, x: number, y: number) => void;
  dimmed: (deviceId: string) => boolean;
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
}

type Drag =
  | { kind: 'move'; device: Device; tpl: DeviceTemplate; start: { x: number; y: number }; offset: { x: number; y: number }; active: boolean; pt: { x: number; y: number } }
  | { kind: 'new'; tpl: DeviceTemplate; pt: { x: number; y: number } };

export function RackScene({ rack, devices, templates, links, overlay, onContextMenu, dimmed, svgRef, renaming, setRenaming }: Props) {
  const { unitPx, wireMode, showBadges } = useUi();
  const { selection, select, moveDevice, createDevice, updateDevice, badges } = useLab();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);

  const trayCount = devices.filter((d) => !d.rack_id && !d.shelf_device_id).length + (drag ? 1 : 0);
  const g = useMemo(() => geometry(unitPx, rack?.total_units ?? 12, trayCount), [unitPx, rack?.total_units, trayCount]);
  const { placed } = useMemo(() => layout(g, rack, devices, templates), [g, rack, devices, templates]);
  const linkedPorts = useMemo(() => new Set(links.flatMap((l) => [l.port_a_id, l.port_b_id])), [links]);
  const occupied = useMemo(() => {
    const s = new Set<number>();
    for (const p of placed) if (p.where === 'rack') for (let i = 0; i < p.tpl.height_u; i++) s.add(p.device.rack_unit_start! + i);
    return s;
  }, [placed]);

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, [svgRef]);

  const shake = (id: string) => {
    setShakeId(id);
    setTimeout(() => setShakeId((s) => (s === id ? null : s)), 400);
  };

  const target: DropTarget | null = useMemo(() => {
    if (!drag) return null;
    if (drag.kind === 'move') {
      if (!drag.active) return null;
      return resolveDrop(g, placed, drag.tpl, drag.pt, drag.offset.y, drag.device.id, rack?.id ?? null);
    }
    return resolveDrop(g, placed, drag.tpl, drag.pt, (drag.tpl.height_u * g.u) / 2, null, rack?.id ?? null);
  }, [drag, g, placed, rack?.id]);

  // ---------- moving existing devices with the pointer ----------
  useEffect(() => {
    if (!drag || drag.kind !== 'move') return;
    const onMove = (e: PointerEvent) => {
      const pt = toSvg(e.clientX, e.clientY);
      setDrag((d) => {
        if (!d || d.kind !== 'move') return d;
        const active = d.active || Math.hypot(pt.x - d.start.x, pt.y - d.start.y) > 5;
        return { ...d, pt, active };
      });
    };
    const onUp = async () => {
      const d = drag;
      setDrag(null);
      if (!d.active) return;
      const t = resolveDrop(g, placed, d.tpl, d.pt, d.offset.y, d.device.id, rack?.id ?? null);
      if (!t) return;
      if (!t.ok) { shake(d.device.id); toast.warn(t.reason ?? 'That spot is taken'); return; }
      try {
        await moveDevice(d.device.id, targetToPlacement(t, rack?.id ?? null));
      } catch (e) {
        shake(d.device.id);
        toast.error(e);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [drag, g, placed, rack?.id, moveDevice, toSvg]);

  // ---------- dropping templates from the library ----------
  const onDragOver = (e: React.DragEvent) => {
    const tid = libraryDrag.templateId;
    const tpl = tid ? templates.find((t) => t.id === tid) : undefined;
    if (!tpl) return;
    e.preventDefault();
    const pt = toSvg(e.clientX, e.clientY);
    setDrag({ kind: 'new', tpl, pt });
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    setDrag(null);
    libraryDrag.templateId = null;
    if (!d || d.kind !== 'new') return;
    const t = resolveDrop(g, placed, d.tpl, toSvg(e.clientX, e.clientY), (d.tpl.height_u * g.u) / 2, null, rack?.id ?? null);
    if (!t) return;
    if (!t.ok) { toast.warn(t.reason ?? 'That spot is taken'); return; }
    const n = devices.filter((x) => x.template_id === d.tpl.id).length + 1;
    try {
      const dev = await createDevice({ name: `${d.tpl.name} ${n}`, template_id: d.tpl.id, status: 'unknown', ...targetToPlacement(t, rack?.id ?? null) });
      select({ kind: 'device', id: dev.id });
      setRenaming(dev.id);
    } catch (err) {
      toast.error(err);
    }
  };

  const ordered = useMemo(() => [...placed].sort((a, b) => rank(a) - rank(b)), [placed]);
  const selectedId = selection?.kind === 'device' ? selection.id : null;

  return (
    <svg
      ref={svgRef}
      width={g.width}
      height={g.height}
      viewBox={`0 0 ${g.width} ${g.height}`}
      className="block select-none"
      style={{ willChange: 'transform', contain: 'paint' }}
      role="group"
      aria-label={`Rack ${rack?.name ?? ''}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag((d) => (d?.kind === 'new' ? null : d)); }}
      onDrop={onDrop}
      onPointerDown={(e) => { if (e.target === e.currentTarget) select(null); }}
    >
      <RackDefs />
      <rect x={0} y={0} width={g.width} height={g.height} fill="url(#rm-ambient)" onPointerDown={() => select(null)} />
      <RackFrame g={g} occupied={occupied} name={rack?.name ?? 'No rack'} />
      <TrayPanel g={g} count={trayCount - (drag ? 1 : 0)} highlight={target?.kind === 'tray' ? 'ok' : 'none'} />

      {ordered.map((p) => {
        const { device: d, box } = p;
        const isDragging = drag?.kind === 'move' && drag.active && drag.device.id === d.id;
        const sel = selectedId === d.id;
        const dim = dimmed(d.id);
        const badge = showBadges ? badges[d.id] ?? 0 : 0;
        return (
          <g
            key={d.id}
            transform={`translate(${box.x} ${box.y})`}
            opacity={isDragging ? 0.35 : dim ? 0.22 : 1}
            className={shakeId === d.id ? 'shake' : undefined}
            style={{ cursor: wireMode ? 'default' : 'grab', transformBox: 'fill-box' }}
            tabIndex={0}
            role="button"
            aria-label={`${d.name}, ${p.tpl.name}, ${describe(p)}, status ${d.status}${badge ? `, ${badge} open project${badge === 1 ? '' : 's'}` : ''}`}
            aria-pressed={sel}
            data-device-id={d.id}
            onPointerDown={(e) => {
              if (e.button !== 0 || wireMode || renaming) return;
              e.stopPropagation();
              select({ kind: 'device', id: d.id });
              const pt = toSvg(e.clientX, e.clientY);
              setDrag({ kind: 'move', device: d, tpl: p.tpl, start: pt, pt, offset: { x: pt.x - box.x, y: pt.y - box.y }, active: false });
            }}
            onDoubleClick={(e) => { e.stopPropagation(); if (!wireMode) setRenaming(d.id); }}
            onContextMenu={(e) => { e.preventDefault(); select({ kind: 'device', id: d.id }); onContextMenu(d.id, e.clientX, e.clientY); }}
            onFocus={() => { if (!sel) select({ kind: 'device', id: d.id }); }}
          >
            <DeviceArt w={box.w} h={box.h} device={d} tpl={p.tpl} linkedPorts={linkedPorts} jack={jackSize(p, g)} />
            {d.color_accent && p.tpl.category !== 'pc' && <rect x={0} y={0} width={3} height={box.h} fill={d.color_accent} pointerEvents="none" />}
            {sel && <rect x={-2} y={-2} width={box.w + 4} height={box.h + 4} rx={4} fill="none" stroke="#38bdf8" strokeWidth={2} pointerEvents="none" />}
            {badge > 0 && (
              <g transform={`translate(${box.w - 4} ${4})`} pointerEvents="all">
                <title>{`${badge} open project${badge === 1 ? '' : 's'}`}</title>
                <circle r={Math.max(7, g.u * 0.17)} fill="#6366f1" stroke="#0b0f17" strokeWidth={1.5} />
                <text y={Math.max(7, g.u * 0.17) * 0.42} textAnchor="middle" fontSize={Math.max(8, g.u * 0.2)} fontWeight={700} fill="#fff" fontFamily="ui-sans-serif, system-ui">{badge}</text>
              </g>
            )}
            {renaming === d.id && (
              <foreignObject x={0} y={Math.max(0, box.h / 2 - 16)} width={Math.max(box.w, 180)} height={32}>
                <RenameInput
                  initial={d.name}
                  onDone={async (name) => {
                    setRenaming(null);
                    if (name && name !== d.name) {
                      try { await updateDevice(d.id, { name }); } catch (e) { toast.error(e); }
                    }
                  }}
                />
              </foreignObject>
            )}
          </g>
        );
      })}

      {/* drop highlight: green when free, red when blocked */}
      {target && target.kind !== 'tray' && (
        <rect x={target.box.x} y={target.box.y} width={target.box.w} height={target.box.h} rx={3}
          fill={target.ok ? '#22c55e' : '#ef4444'} fillOpacity={0.18} stroke={target.ok ? '#22c55e' : '#ef4444'} strokeWidth={2} pointerEvents="none" />
      )}
      {target && target.kind !== 'tray' && !target.ok && target.reason && (
        <text x={target.box.x + target.box.w / 2} y={target.box.y - 6} textAnchor="middle" fontSize={11} fill="#fca5a5" pointerEvents="none" fontFamily="ui-sans-serif, system-ui">{target.reason}</text>
      )}
      {/* ghost following the pointer while moving */}
      {drag?.kind === 'move' && drag.active && (
        <g transform={`translate(${drag.pt.x - drag.offset.x} ${drag.pt.y - drag.offset.y})`} opacity={0.75} pointerEvents="none">
          <DeviceArt w={placed.find((p) => p.device.id === drag.device.id)?.box.w ?? g.faceW} h={placed.find((p) => p.device.id === drag.device.id)?.box.h ?? g.u}
            device={drag.device} tpl={drag.tpl} linkedPorts={linkedPorts} jack={g.u * 0.3} />
        </g>
      )}

      {overlay?.({ g, placed, svg: svgRef.current })}
    </svg>
  );
}

function rank(p: Placed) {
  return p.where === 'rack' ? 0 : p.where === 'shelf' ? 1 : 2;
}

function describe(p: Placed): string {
  if (p.where === 'rack') {
    const s = p.device.rack_unit_start!;
    return p.tpl.height_u > 1 ? `U${s} to U${s + p.tpl.height_u - 1}` : `U${s}`;
  }
  if (p.where === 'shelf') return `on a shelf, slot ${p.device.shelf_slot}`;
  return 'in the unracked tray';
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (name: string) => { if (done.current) return; done.current = true; onDone(name.trim()); };
  return (
    <input
      ref={ref}
      className="input h-8 py-1 text-sm shadow-lg"
      aria-label="Device name"
      value={v}
      maxLength={100}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(initial);
      }}
      onBlur={() => finish(v)}
    />
  );
}

export { ApiError };
