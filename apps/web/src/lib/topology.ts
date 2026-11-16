import type { Device, DeviceTemplate, Link } from '@rackmap/shared';

export interface TopoNode { id: string; depth: number; order: number; parent: string | null }
export interface TopoEdge { link: Link; from: string; to: string; fromPort: string; toPort: string; tree: boolean }
export interface Topology { nodes: TopoNode[]; edges: TopoEdge[]; unconnected: string[]; layers: string[][]; root: string | null }

/**
 * Layered left-to-right tree layout, computed from the same data as the rack (never stored).
 * Root = a router (the one with the most cables), else the best-connected device. Depth = hop count
 * from the root (BFS). Within a layer, nodes are ordered by their parent's position, then by name,
 * so siblings sit together and edges do not cross needlessly.
 */
export function buildTopology(devices: Device[], templates: DeviceTemplate[], links: Link[]): Topology {
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const owner = new Map<string, { device: Device; label: string }>();
  for (const d of devices) for (const p of d.ports) owner.set(p.id, { device: d, label: p.label });

  const adj = new Map<string, { other: string; link: Link }[]>();
  const edges: TopoEdge[] = [];
  for (const l of links) {
    const a = owner.get(l.port_a_id), b = owner.get(l.port_b_id);
    if (!a || !b || a.device.id === b.device.id) continue;
    (adj.get(a.device.id) ?? adj.set(a.device.id, []).get(a.device.id)!).push({ other: b.device.id, link: l });
    (adj.get(b.device.id) ?? adj.set(b.device.id, []).get(b.device.id)!).push({ other: a.device.id, link: l });
    edges.push({ link: l, from: a.device.id, to: b.device.id, fromPort: a.label, toPort: b.label, tree: false });
  }

  const visible = devices.filter((d) => tplById.get(d.template_id)?.category !== 'shelf');
  const degree = (id: string) => adj.get(id)?.length ?? 0;
  const byName = (a: Device, b: Device) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const routers = visible.filter((d) => tplById.get(d.template_id)?.category === 'router' && degree(d.id) > 0);
  const rootDev = [...(routers.length ? routers : visible.filter((d) => degree(d.id) > 0))].sort((a, b) => degree(b.id) - degree(a.id) || byName(a, b))[0];

  const nodes = new Map<string, TopoNode>();
  const layers: string[][] = [];
  const nameOf = new Map(devices.map((d) => [d.id, d.name]));
  // Visit every connected component, starting with the root's.
  const starts = rootDev ? [rootDev, ...visible.filter((d) => d.id !== rootDev.id).sort((a, b) => degree(b.id) - degree(a.id) || byName(a, b))] : [];
  let componentOffset = 0;
  for (const start of starts) {
    if (nodes.has(start.id) || degree(start.id) === 0) continue;
    const base = componentOffset;
    const queue = [start.id];
    nodes.set(start.id, { id: start.id, depth: 0, order: 0, parent: null });
    let maxDepth = 0;
    while (queue.length) {
      const cur = queue.shift()!;
      const n = nodes.get(cur)!;
      const next = (adj.get(cur) ?? [])
        .filter((x) => !nodes.has(x.other))
        // Sort children by the port they hang off on the parent (Port 1, Port 2, ...), then by name.
        .sort((x, y) => portIndex(x.link, cur, owner) - portIndex(y.link, cur, owner) || (nameOf.get(x.other) ?? '').localeCompare(nameOf.get(y.other) ?? ''));
      for (const x of next) {
        if (nodes.has(x.other)) continue;
        nodes.set(x.other, { id: x.other, depth: n.depth + 1, order: 0, parent: cur });
        maxDepth = Math.max(maxDepth, n.depth + 1);
        queue.push(x.other);
        const e = edges.find((ed) => ed.link.id === x.link.id);
        if (e) e.tree = true;
      }
    }
    // Build layers for this component, ordering by parent order (BFS insertion order already respects it).
    const comp = [...nodes.values()].filter((n) => !layers.flat().includes(n.id));
    for (let d = 0; d <= maxDepth; d++) {
      const layer = comp.filter((n) => n.depth === d);
      layer.sort((a, b) => {
        const pa = a.parent ? nodes.get(a.parent)!.order : 0, pb = b.parent ? nodes.get(b.parent)!.order : 0;
        return pa - pb || insertionIndex(nodes, a.id) - insertionIndex(nodes, b.id);
      });
      layer.forEach((n, i) => { n.order = base + i; });
      layers[d] = [...(layers[d] ?? []), ...layer.map((n) => n.id)];
    }
    componentOffset = Math.max(...layers.map((l) => l.length));
  }

  // Orient edges parent -> child for drawing.
  for (const e of edges) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (a && b && (a.depth > b.depth || (a.depth === b.depth && a.order > b.order))) {
      [e.from, e.to] = [e.to, e.from];
      [e.fromPort, e.toPort] = [e.toPort, e.fromPort];
    }
  }
  const unconnected = visible.filter((d) => !nodes.has(d.id)).sort(byName).map((d) => d.id);
  return { nodes: [...nodes.values()], edges, unconnected, layers, root: rootDev?.id ?? null };
}

function portIndex(l: Link, deviceId: string, owner: Map<string, { device: Device; label: string }>): number {
  const pid = owner.get(l.port_a_id)?.device.id === deviceId ? l.port_a_id : l.port_b_id;
  const o = owner.get(pid);
  return o ? o.device.ports.find((p) => p.id === pid)?.position_index ?? 0 : 0;
}
function insertionIndex(nodes: Map<string, TopoNode>, id: string) {
  let i = 0;
  for (const k of nodes.keys()) { if (k === id) return i; i++; }
  return i;
}
