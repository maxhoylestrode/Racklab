import type { Link, Port } from '@rackmap/shared';
import { type Geometry, type Placed, portPoint } from '../rack/geometry';

export interface End { placed: Placed; port: Port; pt: { x: number; y: number } }
export interface Routed { link: Link; a: End; b: End; side: 'left' | 'right'; lane: number; laneX: number; d: string }

export const LANE_SPACING = 7;

export function laneCount(g: Geometry) {
  return Math.max(2, Math.floor((g.laneW - 14) / LANE_SPACING));
}
export function laneX(g: Geometry, side: 'left' | 'right', lane: number) {
  return side === 'left' ? g.laneW - 8 - lane * LANE_SPACING : g.width - g.laneW + 8 + lane * LANE_SPACING;
}

/** Index ports to their placed device for fast lookups. */
export function indexPorts(placed: Placed[]) {
  const m = new Map<string, { placed: Placed; port: Port }>();
  for (const p of placed) for (const port of p.device.ports) m.set(port.id, { placed: p, port });
  return m;
}

/** Where the cable leaves the device: rack gear drops to the lower lip; loose gear exits at its port's height. */
function runY(e: End): number {
  if (e.placed.where === 'rack') return Math.min(e.placed.box.y + e.placed.box.h - 1.5, e.pt.y + e.placed.box.h * 0.45);
  return e.pt.y;
}

/** Gentle gravity sag for a horizontal run of length `len`. */
const sag = (len: number) => Math.min(14, 2 + Math.abs(len) * 0.06);

/** Path from a port out to the lane (or reversed). */
function leg(e: End, lx: number, toLane: boolean): string {
  const ry = runY(e);
  const { x, y } = e.pt;
  const dx = lx - x;
  const s = sag(dx);
  const drop = ry - y;
  if (toLane) {
    return `M${x} ${y} ` + (drop > 0.5 ? `Q${x} ${ry} ${x + Math.sign(dx) * Math.min(6, Math.abs(dx) / 4)} ${ry} ` : '')
      + `C${x + dx * 0.35} ${ry + s} ${x + dx * 0.7} ${ry + s} ${lx} ${ry}`;
  }
  return `C${x + dx * 0.7} ${ry + s} ${x + dx * 0.35} ${ry + s} ${x + Math.sign(dx) * Math.min(6, Math.abs(dx) / 4)} ${ry} `
    + (drop > 0.5 ? `Q${x} ${ry} ${x} ${y}` : `L${x} ${y}`);
}

/**
 * Routes every link: each picks the side nearest its ends, then the least crowded lane on that side
 * (fewest already-routed cables overlapping its vertical span), so many cables stay readable.
 */
export function routeAll(g: Geometry, placed: Placed[], links: Link[]): Routed[] {
  const idx = indexPorts(placed);
  const n = laneCount(g);
  const usage: Record<'left' | 'right', { lo: number; hi: number }[][]> = {
    left: Array.from({ length: n }, () => []),
    right: Array.from({ length: n }, () => []),
  };
  const ends = links
    .map((link) => {
      const pa = idx.get(link.port_a_id), pb = idx.get(link.port_b_id);
      if (!pa || !pb) return null;
      return { link, a: { ...pa, pt: portPoint(pa.placed, pa.port) }, b: { ...pb, pt: portPoint(pb.placed, pb.port) } };
    })
    .filter(Boolean) as { link: Link; a: End; b: End }[];
  // Longer cables first so they take the outer-most free lanes consistently.
  ends.sort((p, q) => Math.abs(q.a.pt.y - q.b.pt.y) - Math.abs(p.a.pt.y - p.b.pt.y));
  const mid = g.faceX + g.faceW / 2;
  const out: Routed[] = [];
  for (const { link, a, b } of ends) {
    const side: 'left' | 'right' = (a.pt.x + b.pt.x) / 2 < mid ? 'left' : 'right';
    const lo = Math.min(runY(a), runY(b)) - 4, hi = Math.max(runY(a), runY(b)) + 4;
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      const overlap = usage[side][i].filter((r) => r.lo < hi && lo < r.hi).length;
      const score = overlap * 100 + i; // prefer inner lanes when equally free
      if (score < bestScore) { bestScore = score; best = i; }
    }
    usage[side][best].push({ lo, hi });
    const lx = laneX(g, side, best);
    const ya = runY(a), yb = runY(b);
    const r = Math.min(8, Math.abs(yb - ya) / 2);
    const dir = Math.sign(yb - ya) || 1;
    const vertical = Math.abs(yb - ya) > 1
      ? ` Q${lx} ${ya} ${lx} ${ya + dir * r} L${lx} ${yb - dir * r} Q${lx} ${yb} ${lx} ${yb}`
      : '';
    const d = `${leg(a, lx, true)}${vertical} ${leg(b, lx, false)}`;
    out.push({ link, a, b, side, lane: best, laneX: lx, d });
  }
  return out;
}
