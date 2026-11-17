import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IpAddress } from '@rackmap/shared';
import { useLab } from '../store/lab';
import { toast } from '../store/toast';
import { useFetch } from '../lib/useFetch';
import { buildTopology } from '../lib/topology';
import { RackDefs } from '../illustrations/defs';
import { DeviceArt } from '../illustrations';
import { DeviceDrawer } from '../components/drawer/DeviceDrawer';
import { cableTone } from '../components/cables/Cables';
import { Empty, StatusDot } from '../components/ui';

const CARD_W = 216, CARD_H = 76, COL_GAP = 120, ROW_GAP = 24, PAD = 32;

/** Logical topology generated from the rack data: root router on the left, hop depth to the right. */
export default function TopologyPage() {
  const { devices, templates, links, loaded, load, selection, select } = useLab();
  const navigate = useNavigate();
  const ips = useFetch<IpAddress[]>('/ip-addresses');
  useEffect(() => { if (!loaded) void load().catch(toast.error); }, [loaded, load]);

  const topo = useMemo(() => buildTopology(devices, templates, links), [devices, templates, links]);
  const primary = useMemo(() => {
    const m = new Map<string, string>();
    for (const ip of ips.data ?? []) if (ip.is_primary || !m.has(ip.device_id)) m.set(ip.device_id, ip.address);
    return m;
  }, [ips.data]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    const tallest = Math.max(1, ...topo.layers.map((l) => l.length));
    const colH = tallest * (CARD_H + ROW_GAP);
    topo.layers.forEach((layer, d) => {
      const h = layer.length * (CARD_H + ROW_GAP);
      layer.forEach((id, i) => m.set(id, { x: PAD + d * (CARD_W + COL_GAP), y: PAD + (colH - h) / 2 + i * (CARD_H + ROW_GAP) }));
    });
    return { m, colH };
  }, [topo]);

  const width = PAD * 2 + Math.max(1, topo.layers.length) * (CARD_W + COL_GAP) - COL_GAP;
  const unconnectedTop = PAD + pos.colH + 32;
  const per = Math.max(1, Math.floor((width - PAD) / (CARD_W + 16)));
  const height = unconnectedTop + (topo.unconnected.length ? 32 + Math.ceil(topo.unconnected.length / per) * (CARD_H + 16) : 0);
  const selectedId = selection?.kind === 'device' ? selection.id : null;
  const devById = new Map(devices.map((d) => [d.id, d]));
  const tplById = new Map(templates.map((t) => [t.id, t]));

  // Glass cards are HTML (real backdrop blur); the edges are a thin SVG layer underneath.
  const Card = ({ id, x, y }: { id: string; x: number; y: number }) => {
    const d = devById.get(id);
    const t = d ? tplById.get(d.template_id) : undefined;
    if (!d || !t) return null;
    const artW = 56, natW = t.width_fraction * 400, natH = t.height_u * 40;
    const artH = Math.min(40, (natH * artW) / natW);
    const sel = selectedId === id;
    return (
      <button type="button" style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
        aria-pressed={sel}
        onClick={() => select({ kind: 'device', id })}
        className={`glass glass-raised glass-lite absolute flex items-center gap-3 rounded-panel px-3 text-left transition-[border-color,box-shadow,transform] duration-base hover:-translate-y-px hover:border-white/20 ${sel ? '!border-accent/80 !shadow-lift' : ''}`}>
        <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-control bg-surface-inset" aria-hidden>
          <svg width={artW} height={artH} viewBox={`0 0 ${natW} ${natH}`}>
            <DeviceArt w={natW} h={natH} device={d} tpl={t} linkedPorts={new Set()} jack={12} showPorts={false} />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{d.name}</span>
            <StatusDot status={d.status} />
          </span>
          <span className={`block truncate font-mono text-xs ${primary.get(id) ? 'text-ink' : 'text-ink-2'}`}>{primary.get(id) ?? 'no IP'}</span>
          <span className="block truncate text-xs text-ink-2">{d.role ?? t.name}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="sr-only">Topology</h1>
        <div className="glass no-print flex h-12 shrink-0 items-center gap-3 rounded-panel px-2">
          <div className="segmented" role="group" aria-label="View">
            <button className="btn" aria-pressed="false" onClick={() => navigate('/')}>Rack</button>
            <button className="btn" aria-pressed="true">Topology</button>
          </div>
          <p className="truncate text-sm text-ink-2">Generated from your cables. Columns are hops from the router.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!topo.root ? (
            <div className="p-2"><Empty title="No connections yet">Wire devices together in the rack view (Wire, then click two ports) and the topology appears here.</Empty></div>
          ) : (
            <div className="relative" style={{ width, height }} role="group" aria-label="Network topology">
              <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="rm-scene absolute inset-0" aria-hidden>
                <RackDefs />
                {topo.edges.map((e) => {
                  const a = pos.m.get(e.from), b = pos.m.get(e.to);
                  if (!a || !b) return null;
                  const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2;
                  const sameCol = Math.abs(x1 - CARD_W - x2) < 1;
                  const d = sameCol
                    ? `M${a.x + CARD_W} ${y1} C${a.x + CARD_W + 50} ${y1} ${b.x + CARD_W + 50} ${y2} ${b.x + CARD_W} ${y2}`
                    : `M${x1} ${y1} C${x1 + COL_GAP / 2} ${y1} ${x2 - COL_GAP / 2} ${y2} ${x2} ${y2}`;
                  const hl = selectedId && (e.from === selectedId || e.to === selectedId);
                  // Labels sit on the curve itself so fanned-out edges keep their port names apart.
                  const at = (t: number) => sameCol
                    ? { x: x1 + 40 * Math.sin(Math.PI * t), y: y1 + (y2 - y1) * t }
                    : bez(t, [x1, y1], [x1 + COL_GAP / 2, y1], [x2 - COL_GAP / 2, y2], [x2, y2]);
                  // The far-end label hugs the target card, where the curve runs flat; the near-end label rides the curve.
                  const pa = at(0.36);
                  const pb = sameCol ? at(0.84) : { x: x2 - 10 - e.toPort.length * 3.6, y: y2 };
                  const fade = selectedId && !hl;
                  return (
                    <g key={e.link.id} opacity={fade ? 0.3 : 1}>
                      <path d={d} fill="none" stroke={hl ? '#45dde0' : cableTone(e.link.cable_color)} strokeWidth={1.5} strokeLinecap="round" strokeOpacity={0.9} strokeDasharray={e.tree ? undefined : '4 4'} />
                      {[{ p: pa, t: e.fromPort }, { p: pb, t: e.toPort }].map(({ p, t }, i) => (
                        <g key={i} transform={`translate(${p.x} ${p.y})`}>
                          <rect x={-t.length * 3.6 - 6} y={-9} width={t.length * 7.2 + 12} height={18} rx={9} fill="#0d0f13" stroke="#ffffff" strokeOpacity={0.1} />
                          <text y={4} textAnchor="middle" fontSize={11} fill="#b4bac3" fontFamily="ui-monospace, monospace">{t}</text>
                        </g>
                      ))}
                    </g>
                  );
                })}
                {topo.unconnected.length > 0 && (
                  <text x={PAD} y={unconnectedTop} fontSize={11} letterSpacing="0.06em" fill="#a0a6af" fontFamily="ui-sans-serif, system-ui" fontWeight={500}>NOT CONNECTED</text>
                )}
              </svg>
              {[...pos.m.entries()].map(([id, p]) => <Card key={id} id={id} x={p.x} y={p.y} />)}
              {topo.unconnected.map((id, i) => (
                <Card key={id} id={id} x={PAD + (i % per) * (CARD_W + 16)} y={unconnectedTop + 16 + Math.floor(i / per) * (CARD_H + 16)} />
              ))}
            </div>
          )}
        </div>
      </div>
      <DeviceDrawer />
    </div>
  );
}

type P = [number, number];
/** Point on a cubic Bézier at t. */
function bez(t: number, p0: P, p1: P, p2: P, p3: P) {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return { x: f(0), y: f(1) };
}
