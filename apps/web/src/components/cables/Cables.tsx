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

const ACCENT = '#45dde0';

/** Real cable jackets are less saturated than their swatch: mix 25% toward a mid grey and darken slightly. */
const cableCache = new Map<string, string>();
export function cableTone(hex: string): string {
  const hit = cableCache.get(hex);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const grey = (ch[0] + ch[1] + ch[2]) / 3;
  const out = '#' + ch.map((c) => Math.round((c * 0.75 + grey * 0.25) * 0.9).toString(16).padStart(2, '0')).join('');
  cableCache.set(hex, out);
  return out;
}

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
            <circle key={e.port.id} cx={e.pt.x} cy={e.pt.y} r={jackSize(e.placed, g) * 0.95} fill="none" stroke={ACCENT} strokeWidth={1.5} />
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
            <circle cx={pt.x} cy={pt.y} r={s * 0.95} fill={busy && !isPending ? '#6b7280' : ACCENT} fillOpacity={isPending ? 0.5 : 0.14}
              stroke={busy && !isPending ? '#6b7280' : ACCENT} strokeOpacity={busy && !isPending ? 0.7 : 1} strokeWidth={1.25} className={isPending || busy ? undefined : 'port-target'} />
          </g>
        );
      }))}

      {/* rubber band from the pending port */}
      {pendingEnd && mouse && (() => {
        const a = portPoint(pendingEnd.placed, pendingEnd.port);
        const dx = mouse.x - a.x;
        return <path d={`M${a.x} ${a.y} C${a.x + dx * 0.3} ${a.y + 30} ${mouse.x - dx * 0.3} ${mouse.y + 30} ${mouse.x} ${mouse.y}`} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeDasharray="6 5" pointerEvents="none" />;
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
  const w = selected || hovered ? 3 : 2.25;
  const tone = cableTone(r.link.cable_color);
  const svgPoint = (e: React.PointerEvent) => {
    const m = (e.currentTarget as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
    const p = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : { x: 0, y: 0 };
    return p;
  };
  return (
    <g opacity={faded ? 0.12 : 1} pointerEvents={wireMode ? 'none' : undefined}>
      {/* soft shadow underneath, offset down */}
      <path d={r.d} fill="none" stroke="#000" strokeOpacity={0.38} strokeWidth={w + 2} strokeLinecap="round" transform="translate(0 1.5)" pointerEvents="none" />
      {selected && <path d={r.d} fill="none" stroke={ACCENT} strokeOpacity={0.35} strokeWidth={w + 4} strokeLinecap="round" pointerEvents="none" />}
      <path d={r.d} fill="none" stroke={tone} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={r.link.cable_type === 'fibre' ? '1 0' : undefined} pointerEvents="none" />
      {/* jacket sheen */}
      <path d={r.d} fill="none" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={0.75} strokeLinecap="round" transform="translate(-0.4 -0.5)" pointerEvents="none" />
      {/* plug boots */}
      {[r.a, r.b].map((e) => <circle key={e.port.id} cx={e.pt.x} cy={e.pt.y} r={2.4} fill={tone} stroke="#000" strokeOpacity={0.55} pointerEvents="none" />)}
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
  const w = Math.max(...lines.map((s) => s.length)) * 6.9 + 36;
  const tx = Math.min(Math.max(4, x + 12), width - w - 4);
  return (
    <g transform={`translate(${tx} ${y + 14})`} pointerEvents="none">
      <rect width={w} height={46} rx={10} fill="#16181e" fillOpacity={0.97} stroke="#ffffff" strokeOpacity={0.12} />
      <line x1={10} y1={0.5} x2={w - 10} y2={0.5} stroke="#ffffff" strokeOpacity={0.12} />
      <circle cx={16} cy={17} r={4} fill={cableTone(l.cable_color)} />
      <text x={26} y={21} fontSize={12} fill="#ebedf0" fontFamily="ui-sans-serif, system-ui" fontWeight={500}>{lines[0]}</text>
      <text x={12} y={37} fontSize={12} fill="#a3a9b2" fontFamily="ui-monospace, monospace">{lines[1]}</text>
    </g>
  );
}
