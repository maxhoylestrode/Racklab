import type { Device, DeviceStatus, DeviceTemplate, InventoryRow, Rack, Service } from '@rackmap/shared';

/** One table row: the device plus everything derived for display, filtering, sorting and grouping. */
export interface InvRow {
  device: Device;
  tpl: DeviceTemplate | undefined;
  /** "Home Rack U10", "Shelf 2 slot 1", "Unracked". */
  position: string;
  /** Sort key for position: rack name, then unit from the top. */
  positionKey: string;
  /** Group key for "rack": the rack name, or "Unracked". Shelf riders group under their shelf's rack. */
  rackName: string;
  racked: boolean;
  extra: InventoryRow | undefined;
}

export const STATUS_ORDER: Record<DeviceStatus, number> = { offline: 0, unknown: 1, planned: 2, online: 3 };

/** Shelves are rack furniture, not devices you manage: the inventory leaves them out (their riders still show "Shelf 2 slot 1"). */
export const isShelf = (d: Device, templates: DeviceTemplate[]) => templates.find((t) => t.id === d.template_id)?.category === 'shelf';

export function buildRows(devices: Device[], templates: DeviceTemplate[], racks: Rack[], extras: InventoryRow[] | null | undefined): InvRow[] {
  const tpl = new Map(templates.map((t) => [t.id, t]));
  const rack = new Map(racks.map((r) => [r.id, r]));
  const dev = new Map(devices.map((d) => [d.id, d]));
  const ex = new Map((extras ?? []).map((e) => [e.device_id, e]));
  return devices.filter((d) => tpl.get(d.template_id)?.category !== 'shelf').map((d) => {
    const t = tpl.get(d.template_id);
    let position = 'Unracked', positionKey = '~', rackName = 'Unracked', racked = false;
    if (d.rack_id && d.rack_unit_start) {
      const r = rack.get(d.rack_id);
      const top = d.rack_unit_start + (t?.height_u ?? 1) - 1;
      position = `${r?.name ?? 'Rack'} U${d.rack_unit_start}${t && t.height_u > 1 ? `-${top}` : ''}`;
      positionKey = `${r?.name ?? ''}|${String(999 - top).padStart(3, '0')}`;
      rackName = r?.name ?? 'Rack';
      racked = true;
    } else if (d.shelf_device_id) {
      const shelf = dev.get(d.shelf_device_id);
      const r = shelf?.rack_id ? rack.get(shelf.rack_id) : undefined;
      position = `${shelf?.name ?? 'Shelf'} slot ${d.shelf_slot ?? 1}`;
      positionKey = `${r?.name ?? '~'}|${String(999 - (shelf?.rack_unit_start ?? 0)).padStart(3, '0')}|${d.shelf_slot ?? 1}`;
      rackName = r?.name ?? 'Unracked';
      racked = !!r;
    }
    return { device: d, tpl: t, position, positionKey, rackName, racked, extra: ex.get(d.id) };
  });
}

// ---------------------------------------------------------------- filters
export interface Filters {
  q: string;
  status: DeviceStatus[];
  role: string[];
  tag: string[];
  placement: '' | 'racked' | 'unracked';
  hasProjects: boolean;
  ipConflict: boolean;
}
export const NO_FILTERS: Filters = { q: '', status: [], role: [], tag: [], placement: '', hasProjects: false, ipConflict: false };

/** Number of active filters (search text excluded), for the "Filters (3)" count. */
export function activeFilterCount(f: Filters): number {
  return (f.status.length ? 1 : 0) + (f.role.length ? 1 : 0) + (f.tag.length ? 1 : 0) + (f.placement ? 1 : 0) + (f.hasProjects ? 1 : 0) + (f.ipConflict ? 1 : 0);
}

/**
 * All filters combine with AND; values inside one filter combine with OR. Search also matches a device whose
 * services match (pass serviceMatches(services, f.q)).
 */
export function filterRows(rows: InvRow[], f: Filters, serviceHits?: Set<string>): InvRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(({ device: d, tpl, position, extra, racked }) => {
    if (f.status.length && !f.status.includes(d.status)) return false;
    if (f.role.length && !f.role.includes(d.role ?? '')) return false;
    if (f.tag.length && !d.tags.some((t) => f.tag.includes(t))) return false;
    if (f.placement === 'racked' && !racked) return false;
    if (f.placement === 'unracked' && racked) return false;
    if (f.hasProjects && !(extra?.open_projects ?? 0)) return false;
    if (f.ipConflict && !extra?.ip_conflict) return false;
    if (q) {
      const hay = [d.name, d.hostname, d.role, d.os, tpl?.name, position, extra?.primary_ip?.address, ...d.tags].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q) && !serviceHits?.has(d.id)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- sorting
export type SortKey = 'name' | 'status' | 'ip' | 'role' | 'template' | 'position' | 'projects' | 'creds' | 'tags' | 'updated' | 'hostname' | 'os';
export interface Sort { key: SortKey | 'default'; dir: 1 | -1 }
export const DEFAULT_SORT: Sort = { key: 'default', dir: 1 };

/** IPv4 numerically; anything else after, alphabetically. */
export function ipSortKey(a: string | undefined): string {
  if (!a) return '~';
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  return m ? m.slice(1).map((x) => x.padStart(3, '0')).join('.') : `z${a}`;
}

const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const byName = (a: InvRow, b: InvRow) => cmpStr(a.device.name, b.device.name);
const COMPARE: Record<SortKey, (a: InvRow, b: InvRow) => number> = {
  name: byName,
  status: (a, b) => STATUS_ORDER[a.device.status] - STATUS_ORDER[b.device.status],
  // Plain comparison: localeCompare would sort the '~' (no IP) marker before digits.
  ip: (a, b) => { const x = ipSortKey(a.extra?.primary_ip?.address), y = ipSortKey(b.extra?.primary_ip?.address); return x < y ? -1 : x > y ? 1 : 0; },
  role: (a, b) => cmpStr(a.device.role ?? '~', b.device.role ?? '~'),
  template: (a, b) => cmpStr(a.tpl?.name ?? '', b.tpl?.name ?? ''),
  position: (a, b) => (a.positionKey < b.positionKey ? -1 : a.positionKey > b.positionKey ? 1 : 0),
  projects: (a, b) => (b.extra?.open_projects ?? 0) - (a.extra?.open_projects ?? 0),
  creds: (a, b) => (b.extra?.credential_count ?? 0) - (a.extra?.credential_count ?? 0),
  tags: (a, b) => cmpStr(a.device.tags.join(',') || '~', b.device.tags.join(',') || '~'),
  updated: (a, b) => b.device.updated_at.localeCompare(a.device.updated_at),
  hostname: (a, b) => cmpStr(a.device.hostname ?? '~', b.device.hostname ?? '~'),
  os: (a, b) => cmpStr(a.device.os ?? '~', b.device.os ?? '~'),
};

/** Default: status (offline first) then name. Any column sort falls back to name for ties. */
export function sortRows(rows: InvRow[], s: Sort): InvRow[] {
  const primary = s.key === 'default' ? COMPARE.status : COMPARE[s.key];
  return [...rows].sort((a, b) => primary(a, b) * s.dir || byName(a, b));
}

// ---------------------------------------------------------------- grouping
export type GroupBy = 'none' | 'rack' | 'role' | 'status';
export interface Group { key: string; label: string; rows: InvRow[] }

export function groupRows(rows: InvRow[], by: GroupBy): Group[] {
  if (by === 'none') return [{ key: 'all', label: 'All devices', rows }];
  const label = (r: InvRow) => (by === 'rack' ? r.rackName : by === 'role' ? r.device.role || 'No role' : r.device.status);
  const map = new Map<string, InvRow[]>();
  for (const r of rows) (map.get(label(r)) ?? map.set(label(r), []).get(label(r))!).push(r);
  const keys = [...map.keys()];
  const last = (k: string) => k === 'Unracked' || k === 'No role';
  keys.sort((a, b) => by === 'status'
    ? STATUS_ORDER[a as DeviceStatus] - STATUS_ORDER[b as DeviceStatus]
    : Number(last(a)) - Number(last(b)) || cmpStr(a, b));
  return keys.map((k) => ({ key: k, label: k, rows: map.get(k)! }));
}

// ---------------------------------------------------------------- columns and CSV
export type ColumnKey = 'status' | 'ip' | 'role' | 'template' | 'position' | 'projects' | 'creds' | 'tags' | 'hostname' | 'os' | 'updated';
export const COLUMNS: { key: ColumnKey; label: string; defaultOn: boolean }[] = [
  { key: 'status', label: 'Status', defaultOn: true },
  { key: 'ip', label: 'Primary IP', defaultOn: true },
  { key: 'role', label: 'Role', defaultOn: true },
  { key: 'template', label: 'Template', defaultOn: true },
  { key: 'position', label: 'Rack position', defaultOn: true },
  { key: 'projects', label: 'Projects', defaultOn: true },
  { key: 'creds', label: 'Credentials', defaultOn: false },
  { key: 'tags', label: 'Tags', defaultOn: true },
  { key: 'hostname', label: 'Hostname', defaultOn: false },
  { key: 'os', label: 'OS', defaultOn: false },
  { key: 'updated', label: 'Updated', defaultOn: true },
];

export function cellText(r: InvRow, c: ColumnKey | 'name'): string {
  const d = r.device;
  switch (c) {
    case 'name': return d.name;
    case 'status': return d.status;
    case 'ip': return r.extra?.primary_ip ? `${r.extra.primary_ip.address}/${r.extra.primary_ip.prefix_length}` : '';
    case 'role': return d.role ?? '';
    case 'template': return r.tpl?.name ?? '';
    case 'position': return r.position;
    case 'projects': return String(r.extra?.open_projects ?? 0);
    case 'creds': return String(r.extra?.credential_count ?? 0);
    case 'tags': return d.tags.join(', ');
    case 'hostname': return d.hostname ?? '';
    case 'os': return d.os ?? '';
    case 'updated': return d.updated_at.slice(0, 10);
  }
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);

/** CSV of the given rows and visible columns only. Formula-looking cells are neutralised. */
export function toCsv(rows: InvRow[], cols: ColumnKey[]): string {
  const header = ['Name', ...cols.map((c) => COLUMNS.find((x) => x.key === c)!.label)];
  const lines = [header, ...rows.map((r) => [cellText(r, 'name'), ...cols.map((c) => cellText(r, c))])];
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** "10.0.0.5/24" or "10.0.0.5" -> address and prefix (default 24 for IPv4, 64 for IPv6). */
export function parseIpInput(v: string): { address: string; prefix_length: number } | null {
  const m = /^\s*([0-9a-fA-F:.]+)(?:\/(\d{1,3}))?\s*$/.exec(v);
  if (!m) return null;
  const v6 = m[1].includes(':');
  return { address: m[1], prefix_length: m[2] ? Number(m[2]) : v6 ? 64 : 24 };
}

export const parseTags = (v: string) => [...new Set(v.split(',').map((t) => t.trim()).filter(Boolean))];

// ---------------------------------------------------------------- services (the per-device directory)
export interface ServiceLine { service: Service; depth: number }

/** A device's services as a depth-first list (parents before children), in the device panel's order. */
export function serviceLines(services: Service[], deviceId: string): ServiceLine[] {
  const mine = services.filter((s) => s.device_id === deviceId);
  const ids = new Set(mine.map((s) => s.id));
  const kids = new Map<string | null, Service[]>();
  for (const s of mine) {
    const parent = s.parent_service_id && ids.has(s.parent_service_id) ? s.parent_service_id : null;
    (kids.get(parent) ?? kids.set(parent, []).get(parent)!).push(s);
  }
  const out: ServiceLine[] = [];
  const walk = (parent: string | null, depth: number) => {
    // Same order as the device panel (buildTree on the server): sort order, then VMID, then name.
    for (const s of (kids.get(parent) ?? []).sort((a, b) => a.sort_order - b.sort_order || (a.vmid_or_ctid ?? 0) - (b.vmid_or_ctid ?? 0) || a.name.localeCompare(b.name))) {
      out.push({ service: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Device ids whose services match the search text (name, kind, VMID, port or URL). */
export function serviceMatches(services: Service[], q: string): Set<string> {
  const needle = q.trim().toLowerCase();
  if (!needle) return new Set();
  return new Set(services
    .filter((s) => [s.name, s.kind, s.vmid_or_ctid?.toString(), s.port_number?.toString(), s.url].filter(Boolean).join(' ').toLowerCase().includes(needle))
    .map((s) => s.device_id));
}
