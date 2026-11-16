import { describe, it, expect } from 'vitest';
import type { Device, DeviceTemplate, Link } from '@rackmap/shared';
import { buildTopology } from './topology';

// Minimal fixtures mirroring the seed lab (spec section 12).
let seq = 0;
const tpl = (key: string, category: DeviceTemplate['category'], ports: string[]): DeviceTemplate => ({
  id: key, key, name: key, category, form_factor: 'rack', height_u: 1, width_fraction: 1, illustration_key: 'generic', shelf_slots: null,
  is_builtin: true, created_at: '', updated_at: '',
  port_layout: ports.map((label, i) => ({ label, kind: 'rj45', speed_mbps: 1000, poe: false, x: i * 10, y: 50 })),
});
const T = {
  router: tpl('generic_router', 'router', ['WAN', 'LAN 1', 'LAN 2', 'LAN 3']),
  sw: tpl('switch_8_port', 'switch', ['Port 1', 'Port 2', 'Port 3', 'Port 4', 'Port 5', 'Port 6', 'Port 7', 'Port 8']),
  pc: tpl('tower_pc', 'pc', ['eth0', 'Power']),
  laptop: tpl('laptop', 'laptop', ['eth0 (dongle)', 'Power']),
  pi: tpl('raspberry_pi_4', 'sbc', ['eth0']),
  r420: tpl('dell_r420', 'server', ['LOM 1', 'LOM 2']),
  shelf: tpl('shelf_1u', 'shelf', []),
};
const dev = (name: string, t: DeviceTemplate): Device => ({
  id: name, name, hostname: null, template_id: t.id, rack_id: null, rack_unit_start: null, rack_side: 'front', shelf_device_id: null, shelf_slot: null,
  role: null, os: null, location_note: null, status: 'online', tags: [], color_accent: null, created_at: '', updated_at: '',
  ports: t.port_layout.map((p, i) => ({ id: `${name}:${p.label}`, device_id: name, label: p.label, kind: p.kind, speed_mbps: 1000, poe: false, position_index: i, layout_x: 0, layout_y: 0, group: null, created_at: '', updated_at: '' })),
});
const link = (a: string, b: string): Link => ({ id: `l${++seq}`, port_a_id: a, port_b_id: b, cable_type: 'cat6', cable_color: '#3b82f6', length_m: null, label: null, notes: null, created_at: '', updated_at: '' });

describe('topology layout', () => {
  it('renders the seed lab as section 10 describes', () => {
    const devices = [
      dev('Router', T.router), dev('Switch 1', T.sw), dev('Desktop PC', T.pc), dev('Laptop', T.laptop), dev('Raspberry Pi', T.pi),
      dev('Switch 2', T.sw), dev('Dell R420', T.r420), dev('PC-case server', T.pc), dev('Shelf 1', T.shelf),
    ];
    const links = [
      link('Router:LAN 1', 'Switch 1:Port 1'),
      link('Desktop PC:eth0', 'Switch 1:Port 2'),
      link('Laptop:eth0 (dongle)', 'Switch 1:Port 3'),
      link('Raspberry Pi:eth0', 'Switch 1:Port 4'),
      link('Switch 1:Port 8', 'Switch 2:Port 1'),
      link('Switch 2:Port 2', 'Dell R420:LOM 1'),
      link('Switch 2:Port 3', 'PC-case server:eth0'),
    ];
    const topo = buildTopology(devices, Object.values(T), links);
    expect(topo.root).toBe('Router');
    expect(topo.layers).toEqual([
      ['Router'],
      ['Switch 1'],
      ['Desktop PC', 'Laptop', 'Raspberry Pi', 'Switch 2'],
      ['Dell R420', 'PC-case server'],
    ]);
    expect(topo.unconnected).toEqual([]); // shelves are not shown
    const sw2 = topo.edges.find((e) => e.to === 'Switch 2')!;
    expect(sw2).toMatchObject({ from: 'Switch 1', fromPort: 'Port 8', toPort: 'Port 1', tree: true });
    expect(topo.edges).toHaveLength(7);
  });

  it('lists devices without cables separately and survives no router', () => {
    const devices = [dev('A', T.sw), dev('B', T.pc), dev('Lonely', T.pi)];
    const topo = buildTopology(devices, Object.values(T), [link('A:Port 1', 'B:eth0')]);
    expect(topo.root).toBe('A');
    expect(topo.layers).toEqual([['A'], ['B']]);
    expect(topo.unconnected).toEqual(['Lonely']);
  });
});
