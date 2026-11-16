import type { DeviceTemplate } from '@rackmap/shared';
import { type Geometry, type Placed, type Box, unitAt, unitTop, shelfSlotBox } from './geometry';
import type { Placement } from '../../store/lab';
import { UNPLACED } from '../../store/lab';

export type DropTarget =
  | { kind: 'rack'; start: number; ok: boolean; box: Box; reason?: string }
  | { kind: 'shelf'; shelfId: string; slot: number; ok: boolean; box: Box; reason?: string }
  | { kind: 'tray'; ok: true };

/**
 * Where would a device of template `tpl` land if dropped at `pt`? `topOffset` is the distance from
 * the pointer to the device's top edge (keeps the grab point stable while moving).
 */
export function resolveDrop(
  g: Geometry, placed: Placed[], tpl: DeviceTemplate, pt: { x: number; y: number }, topOffset: number, excludeId: string | null, rackId: string | null,
): DropTarget | null {
  if (pt.y >= g.trayTop - 12) return { kind: 'tray', ok: true };
  if (pt.x < g.faceX - g.rail * 2 || pt.x > g.faceX + g.faceW + g.rail * 2) return null;

  if (tpl.form_factor === 'loose') {
    const shelf = placed.find((p) => p.where === 'rack' && p.tpl.category === 'shelf' && p.device.id !== excludeId
      && pt.y >= p.box.y && pt.y <= p.box.y + p.box.h && pt.x >= p.box.x && pt.x <= p.box.x + p.box.w);
    if (!shelf) return null;
    const slots = shelf.tpl.shelf_slots ?? 2;
    const slot = Math.min(slots, Math.max(1, Math.floor(((pt.x - shelf.box.x) / shelf.box.w) * slots) + 1));
    const box = shelfSlotBox(g, shelf, slot);
    const taken = placed.find((p) => p.where === 'shelf' && p.device.shelf_device_id === shelf.device.id && p.device.shelf_slot === slot && p.device.id !== excludeId);
    let reason: string | undefined;
    if (taken) reason = `Slot ${slot} holds ${taken.device.name}`;
    else if (tpl.width_fraction > 1 / slots + 1e-6) reason = 'Too wide for this shelf slot';
    else if (tpl.height_u > shelf.tpl.height_u) reason = `Needs a ${tpl.height_u}U shelf`;
    return { kind: 'shelf', shelfId: shelf.device.id, slot, ok: !reason, box, reason };
  }

  if (!rackId) return null;
  const h = tpl.height_u * g.u;
  const top = pt.y - topOffset;
  const start = unitAt(g, top + h - g.u / 2);
  const end = start + tpl.height_u - 1;
  const box = { x: g.faceX, y: unitTop(g, Math.min(end, g.units)), w: g.faceW, h: (Math.min(end, g.units) - start + 1) * g.u };
  let reason: string | undefined;
  if (end > g.units) reason = 'Extends past the top of the rack';
  else {
    const hit = placed.find((p) => p.where === 'rack' && p.device.id !== excludeId && p.device.rack_unit_start
      && start <= p.device.rack_unit_start + p.tpl.height_u - 1 && p.device.rack_unit_start <= end);
    if (hit) reason = `Overlaps ${hit.device.name}`;
  }
  return { kind: 'rack', start, ok: !reason, box, reason };
}

export function targetToPlacement(t: DropTarget, rackId: string | null): Placement {
  if (t.kind === 'tray') return UNPLACED;
  if (t.kind === 'shelf') return { ...UNPLACED, shelf_device_id: t.shelfId, shelf_slot: t.slot };
  return { ...UNPLACED, rack_id: rackId, rack_unit_start: t.start };
}
