import { describe, it, expect } from 'vitest';
import type { Device, DeviceTemplate, InventoryRow, Rack } from '@rackmap/shared';
import { buildRows, filterRows, groupRows, sortRows, toCsv, parseIpInput, activeFilterCount, NO_FILTERS, DEFAULT_SORT } from './inventory';

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' };
const tpl = (id: string, category: DeviceTemplate['category'], height_u = 1, form_factor: DeviceTemplate['form_factor'] = 'rack'): DeviceTemplate => ({
  id, key: id, name: id, category, form_factor, height_u, width_fraction: 1, port_layout: [], illustration_key: 'generic', shelf_slots: category === 'shelf' ? 2 : null, is_builtin: true, ...stamp,
});
const dev = (id: string, over: Partial<Device>): Device => ({
  id, name: id, hostname: null, template_id: 'switch', rack_id: null, rack_unit_start: null, rack_side: 'front', shelf_device_id: null, shelf_slot: null,
  role: null, os: null, location_note: null, status: 'online', tags: [], color_accent: null, ports: [], ...stamp, ...over,
});
const racks: Rack[] = [{ id: 'r1', name: 'Home Rack', total_units: 12, notes: null, ...stamp }];
const templates = [tpl('switch', 'switch'), tpl('server', 'server', 2), tpl('shelf', 'shelf'), tpl('pi', 'sbc', 1, 'loose')];
const devices = [
  dev('Core switch', { rack_id: 'r1', rack_unit_start: 10, role: 'Switch', tags: ['core'] }),
  dev('Hypervisor', { template_id: 'server', rack_id: 'r1', rack_unit_start: 3, role: 'Server', status: 'offline', tags: ['pve', 'core'] }),
  dev('Shelf A', { template_id: 'shelf', rack_id: 'r1', rack_unit_start: 6 }),
  dev('Pi', { template_id: 'pi', shelf_device_id: 'Shelf A', shelf_slot: 2, role: 'Server' }),
  dev('Spare laptop', { template_id: 'pi', status: 'planned' }),
];
const extras: InventoryRow[] = [
  { device_id: 'Core switch', primary_ip: { id: 'i1', address: '10.0.0.2', prefix_length: 24, is_primary: true, vlan_number: null, warnings: [] }, ip_count: 1, ip_conflict: false, open_projects: 0, credential_count: 0 },
  { device_id: 'Hypervisor', primary_ip: { id: 'i2', address: '10.0.0.10', prefix_length: 24, is_primary: true, vlan_number: 10, warnings: [{ code: 'duplicate_ip', message: 'dup' }] }, ip_count: 2, ip_conflict: true, open_projects: 2, credential_count: 3 },
];
const rows = buildRows(devices, templates, racks, extras);
const names = (rs: { device: Device }[]) => rs.map((r) => r.device.name);

describe('inventory rows', () => {
  it('describes rack positions for racked, shelf and loose devices', () => {
    const pos = Object.fromEntries(rows.map((r) => [r.device.name, r.position]));
    expect(pos).toMatchObject({ 'Core switch': 'Home Rack U10', Hypervisor: 'Home Rack U3-4', Pi: 'Shelf A slot 2', 'Spare laptop': 'Unracked' });
    expect(rows.find((r) => r.device.name === 'Pi')!.rackName).toBe('Home Rack');
  });

  it('leaves shelves out (their riders still name the shelf)', () => {
    expect(names(rows)).not.toContain('Shelf A');
    expect(rows).toHaveLength(4);
  });

  it('default sort is status (offline first) then name', () => {
    expect(names(sortRows(rows, DEFAULT_SORT))).toEqual(['Hypervisor', 'Spare laptop', 'Core switch', 'Pi']);
  });

  it('sorts IPs numerically, empty last', () => {
    expect(names(sortRows(rows, { key: 'ip', dir: 1 })).slice(0, 2)).toEqual(['Core switch', 'Hypervisor']);
  });
});

describe('filters and grouping combine', () => {
  it('ANDs filters and ORs values within one filter', () => {
    const f = { ...NO_FILTERS, role: ['Server'], status: ['online' as const, 'offline' as const] };
    expect(names(filterRows(rows, f)).sort()).toEqual(['Hypervisor', 'Pi']);
    expect(names(filterRows(rows, { ...f, placement: 'racked' as const }))).toEqual(['Hypervisor', 'Pi']);
    expect(names(filterRows(rows, { ...f, ipConflict: true }))).toEqual(['Hypervisor']);
    expect(names(filterRows(rows, { ...f, hasProjects: true, tag: ['pve'] }))).toEqual(['Hypervisor']);
    expect(names(filterRows(rows, { ...NO_FILTERS, placement: 'unracked' }))).toEqual(['Spare laptop']);
    expect(activeFilterCount({ ...f, ipConflict: true, q: 'x' })).toBe(3);
  });

  it('searches names, IPs, tags and positions', () => {
    expect(names(filterRows(rows, { ...NO_FILTERS, q: '10.0.0.10' }))).toEqual(['Hypervisor']);
    expect(names(filterRows(rows, { ...NO_FILTERS, q: 'shelf a slot' }))).toEqual(['Pi']);
    expect(names(filterRows(rows, { ...NO_FILTERS, q: 'core' })).sort()).toEqual(['Core switch', 'Hypervisor']);
  });

  it('groups a filtered set by rack, role and status with counts', () => {
    const online = filterRows(rows, { ...NO_FILTERS, status: ['online', 'planned'] });
    expect(groupRows(online, 'rack').map((g) => [g.label, g.rows.length])).toEqual([['Home Rack', 2], ['Unracked', 1]]);
    expect(groupRows(rows, 'role').map((g) => g.label)).toEqual(['Server', 'Switch', 'No role']);
    expect(groupRows(rows, 'status').map((g) => g.label)).toEqual(['offline', 'planned', 'online']);
    expect(groupRows(rows, 'none')[0].rows).toHaveLength(4);
  });
});

describe('CSV export', () => {
  it('includes only visible columns and neutralises formula cells', () => {
    const evil = buildRows([dev('=cmd()', { role: 'a,b' })], templates, racks, []);
    const csv = toCsv([...rows.slice(0, 1), ...evil], ['ip', 'role']);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Name,Primary IP,Role');
    expect(lines[1]).toBe('Core switch,10.0.0.2/24,Switch');
    expect(lines[2]).toBe(`"'=cmd()",,"a,b"`);
    expect(csv).not.toMatch(/credential|secret/i);
  });

  it('parses typed IP addresses', () => {
    expect(parseIpInput('10.1.2.3')).toEqual({ address: '10.1.2.3', prefix_length: 24 });
    expect(parseIpInput(' 10.1.2.3/16 ')).toEqual({ address: '10.1.2.3', prefix_length: 16 });
    expect(parseIpInput('fd00::1')).toEqual({ address: 'fd00::1', prefix_length: 64 });
    expect(parseIpInput('not an ip')).toBeNull();
  });
});
