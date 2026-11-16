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
import { Empty } from '../components/ui';

const CARD_W = 200, CARD_H = 84, COL_GAP = 120, ROW_GAP = 26, PAD = 30;
const STATUS: Record<string, string> = { online: '#22c55e', offline: '#ef4444', planned: '#38bdf8', unknown: '#94a3b8' };

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
  const unconnectedTop = PAD + pos.colH + 30;
  const height = unconnectedTop + (topo.unconnected.length ? 40 + Math.ceil(topo.unconnected.length / Math.max(1, Math.floor(width / (CARD_W + 20)))) * (CARD_H + 20) : 0);
  const selectedId = selection?.kind === 'device' ? selection.id : null;
  const devById = new Map(devices.map((d) => [d.id, d]));
  const tplById = new Map(templates.map((t) => [t.id, t]));

  const Card = ({ id, x, y }: { id: string; x: number; y: number }) => {
    const d = devById.get(id);
    const t = d ? tplById.get(d.template_id) : undefined;
    if (!d || !t) return null;
    const artW = 64, artH = Math.min(48, (t.height_u * 40 * artW) / (t.width_fraction * 400));
    const sel = selectedId === id;
    return (
      <g transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`${d.name}, ${primary.get(id) ?? 'no IP'}, ${d.status}`} aria-pressed={sel}
        onClick={() => select({ kind: 'device', id })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ kind: 'device', id }); } }}
        style={{ cursor: 'pointer' }}>
        <rect width={CARD_W} height={CARD_H} rx={10} fill="#111827" stroke={sel ? '#38bdf8' : '#334155'} strokeWidth={sel ? 2 : 1} filter="url(#rm-shadow)" />
        <rect x={8} y={(CARD_H - 56) / 2} width={artW + 8} height={56} rx={6} fill="#0b0f17" />
        <g transform={`translate(12 ${(CARD_H - artH) / 2}) scale(${artW / (t.width_fraction * 400)})`}>
          <DeviceArt w={t.width_fraction * 400} h={t.height_u * 40} device={d} tpl={t} linkedPorts={new Set()} jack={12} showPorts={false} />
        </g>
        <circle cx={CARD_W - 14} cy={14} r={5} fill={STATUS[d.status]} />
        <text x={artW + 26} y={30} fontSize={12.5} fontWeight={600} fill="#f1f5f9" fontFamily="ui-sans-serif, system-ui">{clip(d.name, 15)}</text>
        <text x={artW + 26} y={48} fontSize={11} fill="#7dd3fc" fontFamily="ui-monospace, monospace">{primary.get(id) ?? 'no IP'}</text>
        <text x={artW + 26} y={64} fontSize={10} fill="#64748b" fontFamily="ui-sans-serif, system-ui">{clip(d.role ?? t.name, 18)}</text>
      </g>
    );
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-print flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <div className="flex rounded-md border border-slate-300 p-0.5 dark:border-slate-700" role="group" aria-label="View">
            <button className="btn btn-ghost btn-sm border-0" aria-pressed="false" onClick={() => navigate('/')}>Rack</button>
            <button className="btn btn-sm btn-on border-0" aria-pressed="true">Topology</button>
          </div>
          <p className="text-xs text-slate-500">Generated from your cables. Depth is the number of hops from the router.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#0b0f17]">
          {!topo.root ? (
            <div className="p-8"><Empty title="No connections yet">Wire some devices together in the rack view and the topology appears here.</Empty></div>
          ) : (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="group" aria-label="Network topology">
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
                const pa = at(0.3), pb = at(0.82);
                return (
                  <g key={e.link.id}>
                    <path d={d} fill="none" stroke={e.link.cable_color} strokeWidth={hl ? 3 : 2} strokeOpacity={selectedId && !hl ? 0.25 : 0.9} strokeDasharray={e.tree ? undefined : '5 4'} />
                    {[{ p: pa, t: e.fromPort }, { p: pb, t: e.toPort }].map(({ p, t }, i) => (
                      <g key={i} transform={`translate(${p.x} ${p.y})`}>
                        <rect x={-t.length * 3.1 - 4} y={-8} width={t.length * 6.2 + 8} height={14} rx={3} fill="#0b0f17" fillOpacity={0.85} />
                        <text y={3} textAnchor="middle" fontSize={10} fill="#94a3b8" fontFamily="ui-monospace, monospace">{t}</text>
                      </g>
                    ))}
                  </g>
                );
              })}
              {[...pos.m.entries()].map(([id, p]) => <Card key={id} id={id} x={p.x} y={p.y} />)}
              {topo.unconnected.length > 0 && (
                <g>
                  <text x={PAD} y={unconnectedTop} fontSize={12} fill="#64748b" fontFamily="ui-sans-serif, system-ui" fontWeight={600}>Not connected</text>
                  {topo.unconnected.map((id, i) => {
                    const per = Math.max(1, Math.floor((width - PAD) / (CARD_W + 20)));
                    return <Card key={id} id={id} x={PAD + (i % per) * (CARD_W + 20)} y={unconnectedTop + 14 + Math.floor(i / per) * (CARD_H + 20)} />;
                  })}
                </g>
              )}
            </svg>
          )}
        </div>
      </div>
      <DeviceDrawer />
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type P = [number, number];
/** Point on a cubic Bézier at t. */
function bez(t: number, p0: P, p1: P, p2: P, p3: P) {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return { x: f(0), y: f(1) };
}
