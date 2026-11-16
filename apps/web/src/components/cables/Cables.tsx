import { memo, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { Link } from '@rackmap/shared';
import type { SceneApi } from '../rack/RackScene';
import { routeAll, indexPorts, type Routed } from './routing';
import { portPoint, jackSize } from '../rack/geometry';
import { useLab } from '../../store/lab';
import { useUi } from '../../store/ui';
import { toast } from '../../store/toast';
import { ApiError } from '../../lib/api';

// ---------- wiring state (wire mode: first port picked, waiting for the second) ----------
interface WiringState { pending: string | null; start: (portId: string) => void; cancel: () => void }
export const useWiring = create<WiringState>((set) => ({
  pending: null,
  start: (pending) => set({ pending }),
  cancel: () => set({ pending: null }),
}));

const fmtSpeed = (m: number | null) => (m == null ? '' : m >= 1000 ? `${m / 1000}G` : `${m}M`);

function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'port_in_use') return `${e.message}. A port can only hold one cable.`;
    if (e.code === 'same_device') return 'A cable must join two different devices.';
    if (e.code === 'self_link') return 'A cable cannot connect a port to itself.';
    return e.message;
  }
  return String(e);
}

export const Cables = memo(function Cables({ scene, dimmed }: { scene: SceneApi; dimmed: (deviceId: string) => boolean }) {
  const { g, placed, svg } = scene;
  const { links, selection, select, createLink, devices } = useLab();
  const { showCables, wireMode } = useUi();
  const { pending, start, cancel } = useWiring();
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const routed = useMemo(() => routeAll(g, placed, links), [g, placed, links]);
  const idx = useMemo(() => indexPorts(placed), [placed]);
  const linkedPorts = useMemo(() => new Map(links.flatMap((l) => [[l.port_a_id, l] as const, [l.port_b_id, l] as const])), [links]);
  const selectedLink = selection?.kind === 'link' ? selection.id : null;
  const selectedDevice = selection?.kind === 'device' ? selection.id : null;

  // Track the pointer for the rubber-band preview while a cable is pending.
  useEffect(() => {
    if (!pending || !svg) return;
    const onMove = (e: PointerEvent) => {
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      setMouse({ x: p.x, y: p.y });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [pending, svg]);
  useEffect(() => { if (!wireMode) cancel(); }, [wireMode, cancel]);

  const clickPort = async (portId: string) => {
    if (!pending) {
      const busy = linkedPorts.get(portId);
      if (busy) {
        const e = idx.get(portId);
        toast.warn(`${e?.placed.device.name} ${e?.port.label} already has a cable. A port can only hold one cable.`);
        return;
      }
      start(portId);
      return;
    }
    if (pending === portId) { cancel(); return; }
    const a = pending;
    cancel();
    try {
      const l = await createLink(a, portId, { cable_type: 'cat6', cable_color: '#3b82f6' });
      for (const w of l.warnings ?? []) toast.warn(w.message);
      if (!l.warnings?.length) toast.success('Cable added');
    } catch (e) {
      toast.warn(friendly(e));
    }
  };

  const hovered = hover ? routed.find((r) => r.link.id === hover.id) : undefined;
  const cableFaded = (r: Routed) => dimmed(r.a.placed.device.id) && dimmed(r.b.placed.device.id)
    || (!!selectedDevice && useUi.getState().dimUnrelated && r.a.placed.device.id !== selectedDevice && r.b.placed.device.id !== selectedDevice);
  const pendingEnd = pending ? idx.get(pending) : undefined;

  return (
    <g>
      {showCables && routed.map((r) => (
        <Cable key={r.link.id} r={r} selected={selectedLink === r.link.id} hovered={hover?.id === r.link.id} faded={cableFaded(r)} wireMode={wireMode}
          onHover={(on, x, y) => setHover(on ? { id: r.link.id, x, y } : null)}
          onSelect={() => select({ kind: 'link', id: r.link.id })} />
      ))}

      {/* endpoint highlight for hovered / selected cable */}
      {showCables && [hovered, routed.find((r) => r.link.id === selectedLink)].filter(Boolean).map((r) => (
        <g key={`ends-${r!.link.id}`} pointerEvents="none">
          {[r!.a, r!.b].map((e) => (
            <circle key={e.port.id} cx={e.pt.x} cy={e.pt.y} r={jackSize(e.placed, g) * 0.95} fill="none" stroke="#fde047" strokeWidth={2} filter="url(#rm-glow)" />
          ))}
        </g>
      ))}

      {/* wire mode: every visible port is a hit target */}
      {wireMode && placed.map((p) => p.device.ports.map((port) => {
        const pt = portPoint(p, port);
        const s = jackSize(p, g);
        const busy = linkedPorts.has(port.id);
        const isPending = pending === port.id;
        return (
          <g key={port.id} role="button" tabIndex={0}
            aria-label={`${p.device.name} ${port.label}${busy ? ', has a cable' : ', free'}${isPending ? ', selected as cable start' : ''}`}
            onClick={(e) => { e.stopPropagation(); void clickPort(port.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void clickPort(port.id); } }}
            style={{ cursor: busy && !pending ? 'not-allowed' : 'crosshair' }}>
            <title>{`${p.device.name} ${port.label} (${port.kind}${port.speed_mbps ? ` ${fmtSpeed(port.speed_mbps)}` : ''}${port.poe ? ' PoE' : ''})`}</title>
            <circle cx={pt.x} cy={pt.y} r={s * 0.95} fill={isPending ? '#38bdf8' : busy ? '#64748b' : '#22d3ee'} fillOpacity={isPending ? 0.55 : 0.18}
              stroke={isPending ? '#38bdf8' : busy ? '#64748b' : '#22d3ee'} strokeWidth={1.5} className={isPending || busy ? undefined : 'port-target'} />
          </g>
        );
      }))}

      {/* rubber band from the pending port */}
      {pendingEnd && mouse && (() => {
        const a = portPoint(pendingEnd.placed, pendingEnd.port);
        const dx = mouse.x - a.x;
        return <path d={`M${a.x} ${a.y} C${a.x + dx * 0.3} ${a.y + 30} ${mouse.x - dx * 0.3} ${mouse.y + 30} ${mouse.x} ${mouse.y}`} fill="none" stroke="#38bdf8" strokeWidth={2.5} strokeDasharray="6 4" pointerEvents="none" />;
      })()}

      {/* tooltip */}
      {hovered && hover && <CableTooltip r={hovered} x={hover.x} y={hover.y} width={g.width} devicesCount={devices.length} />}
    </g>
  );
});

const Cable = memo(function Cable({ r, selected, hovered, faded, wireMode, onHover, onSelect }: {
  r: Routed; selected: boolean; hovered: boolean; faded: boolean; wireMode: boolean;
  onHover: (on: boolean, x: number, y: number) => void; onSelect: () => void;
}) {
  const w = selected || hovered ? 4 : 3;
  const svgPoint = (e: React.PointerEvent) => {
    const m = (e.currentTarget as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
    const p = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : { x: 0, y: 0 };
    return p;
  };
  return (
    <g opacity={faded ? 0.12 : 1} pointerEvents={wireMode ? 'none' : undefined}>
      <path d={r.d} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={w + 2.5} strokeLinecap="round" pointerEvents="none" />
      <path d={r.d} fill="none" stroke={r.link.cable_color} strokeWidth={w} strokeLinecap="round" strokeDasharray={r.link.cable_type === 'fibre' ? '1 0' : undefined} pointerEvents="none" />
      <path d={r.d} fill="none" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1} strokeLinecap="round" transform="translate(-0.6 -0.6)" pointerEvents="none" />
      {selected && <path d={r.d} fill="none" stroke="#fde047" strokeWidth={1.2} strokeDasharray="4 4" pointerEvents="none" />}
      {/* plug boots */}
      {[r.a, r.b].map((e) => <circle key={e.port.id} cx={e.pt.x} cy={e.pt.y} r={2.2} fill={r.link.cable_color} stroke="#000" strokeOpacity={0.5} pointerEvents="none" />)}
      {/* wide invisible hit path */}
      <path d={r.d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
        role="button" tabIndex={0} aria-label={`Cable ${r.a.placed.device.name} ${r.a.port.label} to ${r.b.placed.device.name} ${r.b.port.label}`}
        onPointerEnter={(e) => { const p = svgPoint(e); onHover(true, p.x, p.y); }}
        onPointerMove={(e) => { const p = svgPoint(e); onHover(true, p.x, p.y); }}
        onPointerLeave={(e) => onHover(false, e.clientX, e.clientY)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        onFocus={(e) => { const bb = (e.currentTarget as SVGPathElement).getBBox(); onHover(true, bb.x + bb.width / 2, bb.y + bb.height / 2); }}
        onBlur={() => onHover(false, 0, 0)} />
    </g>
  );
});

function CableTooltip({ r, x, y, width }: { r: Routed; x: number; y: number; width: number; devicesCount: number }) {
  const l: Link = r.link;
  const lines = [
    `${r.a.placed.device.name} ${r.a.port.label} → ${r.b.placed.device.name} ${r.b.port.label}`,
    `${l.cable_type.toUpperCase()}${l.length_m ? ` · ${l.length_m} m` : ''}${l.label ? ` · ${l.label}` : ''}`,
  ];
  const w = Math.max(...lines.map((s) => s.length)) * 6.4 + 20;
  const tx = Math.min(Math.max(4, x + 12), width - w - 4);
  return (
    <g transform={`translate(${tx} ${y + 14})`} pointerEvents="none">
      <rect width={w} height={42} rx={6} fill="#0f172a" fillOpacity={0.95} stroke="#334155" />
      <rect x={8} y={9} width={8} height={8} rx={2} fill={l.cable_color} />
      <text x={22} y={17} fontSize={11.5} fill="#f1f5f9" fontFamily="ui-sans-serif, system-ui" fontWeight={600}>{lines[0]}</text>
      <text x={10} y={33} fontSize={11} fill="#94a3b8" fontFamily="ui-sans-serif, system-ui">{lines[1]}</text>
    </g>
  );
}
