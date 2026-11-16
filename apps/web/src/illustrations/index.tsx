import { memo, type ComponentType } from 'react';
import type { Device, DeviceTemplate } from '@rackmap/shared';
import type { ArtProps } from './types';
import { SwitchArt } from './switch';
import { ServerArt } from './dellServer';
import { RaspberryPiArt } from './raspberryPi';
import { TowerPcArt } from './towerPc';
import { RouterArt } from './router';
import { LaptopArt } from './laptop';
import { ShelfArt } from './shelf';
import { PatchPanelArt } from './patchPanel';
import { GenericArt } from './generic';
import { Jack } from './ports';

/** illustration_key -> SVG component. Unknown keys fall back to the generic faceplate. */
export const ILLUSTRATIONS: Record<string, ComponentType<ArtProps>> = {
  switch: SwitchArt,
  dell_r420: ServerArt,
  dell_r720: ServerArt,
  raspberry_pi: RaspberryPiArt,
  tower_pc: TowerPcArt,
  router: RouterArt,
  laptop: LaptopArt,
  shelf: ShelfArt,
  patch_panel: PatchPanelArt,
  generic: GenericArt,
};

/**
 * A device's full illustration at local origin: body art, then its jacks at their layout positions,
 * then the offline overlay. `linkedPorts` drives the LEDs.
 */
export const DeviceArt = memo(function DeviceArt({ w, h, device, tpl, linkedPorts, jack, showPorts = true }: {
  w: number; h: number; device: Device; tpl: DeviceTemplate; linkedPorts: Set<string>; jack: number; showPorts?: boolean;
}) {
  const Art = ILLUSTRATIONS[tpl.illustration_key] ?? GenericArt;
  const offline = device.status === 'offline';
  return (
    <g opacity={device.status === 'planned' ? 0.6 : 1}>
      <Art w={w} h={h} device={device} tpl={tpl} />
      {showPorts && device.ports.map((p) => (
        <Jack key={p.id} port={p} x={(p.layout_x / 1000) * w} y={(p.layout_y / (tpl.height_u * 100)) * h} s={jack} linked={linkedPorts.has(p.id) && !offline} offline={offline} />
      ))}
      {offline && <rect width={w} height={h} rx={2} fill="#475569" fillOpacity={0.35} pointerEvents="none" />}
      {device.status === 'planned' && <rect width={w} height={h} rx={2} fill="none" stroke="#38bdf8" strokeDasharray="4 3" pointerEvents="none" />}
    </g>
  );
});

/** Small standalone thumbnail (library, topology cards, drawer). */
export function DeviceThumb({ device, tpl, width = 120 }: { device: Device; tpl: DeviceTemplate; width?: number }) {
  const u = 40;
  const w = tpl.width_fraction * u * 10;
  const h = tpl.height_u * u;
  return (
    <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} width={width} height={(width * (h + 4)) / (w + 4)} aria-hidden>
      <DeviceArt w={w} h={h} device={device} tpl={tpl} linkedPorts={new Set()} jack={u * 0.3} />
    </svg>
  );
}

/** A fake device used to preview a template (library thumbnails). */
export function previewDevice(tpl: DeviceTemplate): Device {
  return {
    id: `preview-${tpl.id}`, name: tpl.name, hostname: null, template_id: tpl.id, rack_id: null, rack_unit_start: null, rack_side: 'front',
    shelf_device_id: null, shelf_slot: null, role: null, os: null, location_note: null, status: 'online', tags: [], color_accent: null,
    created_at: '', updated_at: '',
    ports: tpl.port_layout.map((p, i) => ({
      id: `pp-${tpl.id}-${i}`, device_id: '', label: p.label, kind: p.kind, speed_mbps: p.speed_mbps, poe: p.poe, position_index: i,
      layout_x: p.x, layout_y: p.y, group: p.group ?? null, created_at: '', updated_at: '',
    })),
  };
}
