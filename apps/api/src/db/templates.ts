import type { DeviceCategory, FormFactor, PortLayoutEntry, PortKind } from '@rackmap/shared';

export interface BuiltinTemplate {
  key: string;
  name: string;
  category: DeviceCategory;
  form_factor: FormFactor;
  height_u: number;
  width_fraction: number;
  illustration_key: string;
  shelf_slots?: number;
  port_layout: PortLayoutEntry[];
}

const p = (label: string, kind: PortKind, x: number, y: number, extra: Partial<PortLayoutEntry> = {}): PortLayoutEntry => ({
  label,
  kind,
  speed_mbps: kind === 'rj45' ? 1000 : kind === 'sfp' ? 1000 : kind === 'sfp_plus' ? 10000 : null,
  poe: false,
  x,
  y,
  ...extra,
});

/** A row of RJ45 ports starting at x0, spaced dx apart. */
function rj45Row(count: number, x0: number, y: number, dx: number, opts: { prefix?: string; start?: number; poe?: boolean; group?: (i: number) => string } = {}) {
  const { prefix = 'Port ', start = 1, poe = false, group } = opts;
  return Array.from({ length: count }, (_, i) =>
    p(`${prefix}${start + i}`, 'rj45', x0 + i * dx, y, { poe, group: group?.(i) }),
  );
}

function switch8(poe: boolean): PortLayoutEntry[] {
  const ports = rj45Row(8, 430, 50, 62, { poe, group: () => 'A' });
  ports[7].uplink = true;
  return ports;
}

function switch24(): PortLayoutEntry[] {
  // Two rows of 12: odd ports on top, even ports on the bottom, in blocks of 6.
  const ports: PortLayoutEntry[] = [];
  for (let i = 0; i < 24; i++) {
    const col = Math.floor(i / 2);
    const block = Math.floor(col / 6);
    const x = 250 + col * 50 + block * 30;
    const y = i % 2 === 0 ? 32 : 70;
    ports.push(p(`Port ${i + 1}`, 'rj45', x, y, { group: `B${block + 1}` }));
  }
  ports.push(p('SFP 1', 'sfp', 900, 50, { group: 'SFP' }), p('SFP 2', 'sfp', 950, 50, { group: 'SFP' }));
  return ports;
}

function patchPanel24(): PortLayoutEntry[] {
  return Array.from({ length: 24 }, (_, i) => {
    const block = Math.floor(i / 6);
    return p(`${i + 1}`, 'rj45', 110 + i * 32 + block * 22, 50, { speed_mbps: null, group: `K${block + 1}` });
  });
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: 'generic_router', name: 'Generic router', category: 'router', form_factor: 'loose', height_u: 1, width_fraction: 0.5,
    illustration_key: 'router',
    port_layout: [p('WAN', 'rj45', 250, 80), p('LAN 1', 'rj45', 450, 80), p('LAN 2', 'rj45', 600, 80), p('LAN 3', 'rj45', 750, 80)],
  },
  {
    key: 'switch_8_port', name: '8 port switch', category: 'switch', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'switch', port_layout: switch8(false),
  },
  {
    key: 'switch_8_port_poe', name: '8 port PoE switch', category: 'switch', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'switch', port_layout: switch8(true),
  },
  {
    key: 'switch_24_port', name: '24 port switch', category: 'switch', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'switch', port_layout: switch24(),
  },
  {
    key: 'dell_r420', name: 'Dell PowerEdge R420', category: 'server', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'dell_r420',
    port_layout: [
      p('LOM 1', 'rj45', 700, 50, { group: 'LOM' }),
      p('LOM 2', 'rj45', 745, 50, { group: 'LOM' }),
      p('iDRAC', 'idrac', 800, 50, { speed_mbps: 1000 }),
      p('USB 1', 'usb', 640, 35),
      p('USB 2', 'usb', 640, 65),
      p('VGA', 'other', 590, 50),
      p('PSU 1', 'power', 880, 50, { group: 'PSU' }),
      p('PSU 2', 'power', 940, 50, { group: 'PSU' }),
    ],
  },
  {
    key: 'dell_r720', name: 'Dell PowerEdge R720', category: 'server', form_factor: 'rack', height_u: 2, width_fraction: 1,
    illustration_key: 'dell_r720',
    port_layout: [
      p('NIC 1', 'rj45', 660, 150, { group: 'NIC' }),
      p('NIC 2', 'rj45', 705, 150, { group: 'NIC' }),
      p('NIC 3', 'rj45', 750, 150, { group: 'NIC' }),
      p('NIC 4', 'rj45', 795, 150, { group: 'NIC' }),
      p('iDRAC', 'idrac', 850, 150, { speed_mbps: 1000 }),
      p('PSU 1', 'power', 910, 60, { group: 'PSU' }),
      p('PSU 2', 'power', 910, 140, { group: 'PSU' }),
    ],
  },
  {
    key: 'raspberry_pi_4', name: 'Raspberry Pi 4', category: 'sbc', form_factor: 'loose', height_u: 1, width_fraction: 0.5,
    illustration_key: 'raspberry_pi',
    port_layout: [
      p('eth0', 'rj45', 880, 50),
      p('USB 1', 'usb', 740, 30), p('USB 2', 'usb', 740, 70),
      p('USB 3', 'usb', 640, 30), p('USB 4', 'usb', 640, 70),
      p('USB-C', 'power', 120, 85),
      p('HDMI 0', 'hdmi', 260, 85), p('HDMI 1', 'hdmi', 380, 85),
    ],
  },
  {
    key: 'tower_pc', name: 'Tower PC', category: 'pc', form_factor: 'loose', height_u: 2, width_fraction: 0.5,
    illustration_key: 'tower_pc',
    port_layout: [p('eth0', 'rj45', 860, 120), p('Power', 'power', 860, 175)],
  },
  {
    key: 'laptop', name: 'Laptop', category: 'laptop', form_factor: 'loose', height_u: 1, width_fraction: 0.5,
    illustration_key: 'laptop',
    port_layout: [p('eth0 (dongle)', 'rj45', 900, 80), p('Power', 'power', 100, 80)],
  },
  {
    key: 'shelf_1u', name: '1U shelf', category: 'shelf', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'shelf', shelf_slots: 2, port_layout: [],
  },
  {
    key: 'shelf_2u', name: '2U shelf', category: 'shelf', form_factor: 'rack', height_u: 2, width_fraction: 1,
    illustration_key: 'shelf', shelf_slots: 2, port_layout: [],
  },
  {
    key: 'patch_panel_24', name: '24 port patch panel', category: 'patch_panel', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'patch_panel', port_layout: patchPanel24(),
  },
  {
    key: 'generic_custom', name: 'Custom device', category: 'other', form_factor: 'rack', height_u: 1, width_fraction: 1,
    illustration_key: 'generic', port_layout: [],
  },
];
