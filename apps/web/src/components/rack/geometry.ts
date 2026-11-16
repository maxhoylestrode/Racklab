import type { Device, DeviceTemplate, Port, Rack } from '@rackmap/shared';

/**
 * Rack scene geometry. Everything is derived from the unit height `u` (px per rack unit).
 * A 19" faceplate is ~10.9x as wide as 1U is tall; the usable face between the rails is ~10x.
 */
export interface Geometry {
  u: number;
  units: number;
  laneW: number; // cable lane band on each side
  gutter: number; // U number column
  rail: number;
  faceW: number;
  topPanel: number;
  bottomPanel: number;
  width: number;
  rackTop: number; // y of the top of unit `units`
  rackHeight: number;
  faceX: number; // x of the left edge of the device face area
  trayTop: number;
  trayCols: number;
  trayCellW: number;
  trayCellH: number;
  trayHeight: number;
  height: number;
}

export function geometry(u: number, units: number, trayCount: number): Geometry {
  const laneW = Math.round(u * 2.6);
  const gutter = Math.max(22, Math.round(u * 0.55));
  const rail = Math.round(u * 0.42);
  const faceW = Math.round(u * 10);
  const topPanel = Math.round(u * 0.7);
  const bottomPanel = Math.round(u * 0.9);
  const width = laneW * 2 + gutter * 2 + rail * 2 + faceW;
  const rackTop = topPanel + 8;
  const rackHeight = units * u;
  const faceX = laneW + gutter + rail;
  const trayCols = 2;
  const trayCellW = Math.floor(faceW / trayCols);
  const trayCellH = Math.round(u * 2.2);
  const trayRows = Math.max(1, Math.ceil(trayCount / trayCols));
  const trayTop = rackTop + rackHeight + bottomPanel + 36;
  const trayHeight = trayRows * (trayCellH + 10) + 34;
  return {
    u, units, laneW, gutter, rail, faceW, topPanel, bottomPanel, width, rackTop, rackHeight, faceX,
    trayTop, trayCols, trayCellW, trayCellH, trayHeight, height: trayTop + trayHeight + 8,
  };
}

/** y of the top edge of rack unit n (1 = bottom). */
export const unitTop = (g: Geometry, n: number) => g.rackTop + (g.units - n) * g.u;

/** Rack unit under a y coordinate (clamped). */
export function unitAt(g: Geometry, y: number): number {
  const fromTop = Math.floor((y - g.rackTop) / g.u);
  return Math.max(1, Math.min(g.units, g.units - fromTop));
}

export interface Box { x: number; y: number; w: number; h: number }

export interface Placed {
  device: Device;
  tpl: DeviceTemplate;
  box: Box;
  where: 'rack' | 'shelf' | 'tray';
}

/** Computes on-screen boxes for every device of a rack, its shelves' riders and the unracked tray. */
export function layout(g: Geometry, rack: Rack | undefined, devices: Device[], templates: DeviceTemplate[]): { placed: Placed[]; tray: Device[] } {
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const placed: Placed[] = [];
  const inRack = rack ? devices.filter((d) => d.rack_id === rack.id && d.rack_unit_start) : [];
  const rackIds = new Set(inRack.map((d) => d.id));
  for (const d of inRack) {
    const tpl = tplById.get(d.template_id);
    if (!tpl) continue;
    const top = unitTop(g, d.rack_unit_start! + tpl.height_u - 1);
    placed.push({ device: d, tpl, box: { x: g.faceX, y: top, w: g.faceW, h: tpl.height_u * g.u }, where: 'rack' });
  }
  // Devices sitting on shelves that are in this rack.
  for (const d of devices) {
    if (!d.shelf_device_id || !rackIds.has(d.shelf_device_id)) continue;
    const shelf = placed.find((p) => p.device.id === d.shelf_device_id);
    const tpl = tplById.get(d.template_id);
    if (!shelf || !tpl) continue;
    const box = shelfSlotBox(g, shelf, d.shelf_slot ?? 1);
    const h = Math.min(tpl.height_u * g.u, box.h);
    const w = Math.min(box.w, tpl.width_fraction * g.faceW);
    placed.push({ device: d, tpl, box: { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h }, where: 'shelf' });
  }
  // Unracked tray: anything not in a rack and not on a shelf (in any rack).
  const tray = devices.filter((d) => !d.rack_id && !d.shelf_device_id);
  tray.forEach((d, i) => {
    const tpl = tplById.get(d.template_id);
    if (!tpl) return;
    const col = i % g.trayCols;
    const row = Math.floor(i / g.trayCols);
    const cell = { x: g.faceX + col * g.trayCellW, y: g.trayTop + 28 + row * (g.trayCellH + 10), w: g.trayCellW, h: g.trayCellH };
    // Fit the device into the cell, keeping its aspect.
    const natW = tpl.width_fraction * g.faceW;
    const natH = tpl.height_u * g.u;
    const s = Math.min((cell.w - 16) / natW, (cell.h - 8) / natH, 1);
    const w = natW * s, h = natH * s;
    placed.push({ device: d, tpl, box: { x: cell.x + (cell.w - w) / 2, y: cell.y + cell.h - h - 4, w, h }, where: 'tray' });
  });
  return { placed, tray };
}

/** The usable area of slot n (1-based) on a shelf, above its tray lip. */
export function shelfSlotBox(g: Geometry, shelf: Placed, slot: number): Box {
  const slots = shelf.tpl.shelf_slots ?? 2;
  const lip = Math.max(4, g.u * 0.16);
  const w = shelf.box.w / slots;
  return { x: shelf.box.x + (slot - 1) * w, y: shelf.box.y + 2, w, h: shelf.box.h - lip - 2 };
}

/** Screen position of a port's centre. */
export function portPoint(p: Placed, port: Port): { x: number; y: number } {
  return {
    x: p.box.x + (port.layout_x / 1000) * p.box.w,
    y: p.box.y + (port.layout_y / (p.tpl.height_u * 100)) * p.box.h,
  };
}

/** Jack size in px for a placed device (shrinks in the tray). */
export function jackSize(p: Placed, g: Geometry): number {
  const scale = p.box.h / (p.tpl.height_u * g.u);
  return Math.max(5, g.u * 0.3 * scale);
}
