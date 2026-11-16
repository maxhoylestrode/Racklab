import { and, eq, ne, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client';
import { devices, deviceTemplates, racks } from '../db/schema';
import { HttpError, badRequest } from '../errors';

export interface Placement {
  rack_id: string | null;
  rack_unit_start: number | null;
  shelf_device_id: string | null;
  shelf_slot: number | null;
}

type Template = typeof deviceTemplates.$inferSelect;

const placementError = (msg: string, code: string, details?: unknown) => new HttpError(409, msg, code, details);

/** Normalises a requested placement for a template: fills implied nulls and rejects mixed modes. */
export function normalisePlacement(tpl: Template, p: Partial<Placement>): Placement {
  const out: Placement = {
    rack_id: p.rack_id ?? null,
    rack_unit_start: p.rack_unit_start ?? null,
    shelf_device_id: p.shelf_device_id ?? null,
    shelf_slot: p.shelf_slot ?? null,
  };
  const inRack = out.rack_id !== null || out.rack_unit_start !== null;
  const onShelf = out.shelf_device_id !== null || out.shelf_slot !== null;
  if (inRack && onShelf) throw badRequest('A device is either in the rack or on a shelf, not both', 'placement_mixed');
  if (inRack && (out.rack_id === null || out.rack_unit_start === null)) throw badRequest('Rack placement needs rack_id and rack_unit_start', 'placement_incomplete');
  if (onShelf && (out.shelf_device_id === null || out.shelf_slot === null)) throw badRequest('Shelf placement needs shelf_device_id and shelf_slot', 'placement_incomplete');
  if (tpl.form_factor === 'loose' && inRack) throw placementError('Loose devices can only go on a shelf or in the unracked tray', 'loose_needs_shelf');
  if (tpl.form_factor === 'rack' && onShelf) throw placementError('Rack-mount devices go in rack units, not on a shelf', 'rack_device_on_shelf');
  return out;
}

/**
 * Enforces the server-side placement rules (spec section 7):
 *  - no two devices overlap in the same rack units
 *  - a device cannot extend past the rack
 *  - a shelf slot holds one device (and the device must fit the shelf)
 */
export async function validatePlacement(db: DB, tpl: Template, p: Placement, selfId: string | null): Promise<void> {
  if (p.rack_id && p.rack_unit_start !== null) {
    const [rack] = await db.select().from(racks).where(eq(racks.id, p.rack_id)).limit(1);
    if (!rack) throw badRequest('Rack not found', 'rack_not_found');
    const lo = p.rack_unit_start;
    const hi = lo + tpl.height_u - 1;
    if (lo < 1 || hi > rack.total_units) {
      throw placementError(`Device needs U${lo} to U${hi} but the rack has ${rack.total_units}U`, 'out_of_rack', { lo, hi, total: rack.total_units });
    }
    const others = await db
      .select({ id: devices.id, name: devices.name, start: devices.rack_unit_start, height: deviceTemplates.height_u })
      .from(devices)
      .innerJoin(deviceTemplates, eq(devices.template_id, deviceTemplates.id))
      .where(and(eq(devices.rack_id, p.rack_id), isNotNull(devices.rack_unit_start), selfId ? ne(devices.id, selfId) : undefined));
    const hit = others.find((o) => {
      const olo = o.start!;
      const ohi = olo + o.height - 1;
      return lo <= ohi && olo <= hi;
    });
    if (hit) throw placementError(`Units U${lo}-U${hi} overlap ${hit.name}`, 'collision', { with: hit.id });
  }

  if (p.shelf_device_id && p.shelf_slot !== null) {
    if (p.shelf_device_id === selfId) throw badRequest('A device cannot sit on itself', 'placement_self');
    const [shelf] = await db
      .select({ id: devices.id, name: devices.name, tpl: deviceTemplates })
      .from(devices)
      .innerJoin(deviceTemplates, eq(devices.template_id, deviceTemplates.id))
      .where(eq(devices.id, p.shelf_device_id))
      .limit(1);
    if (!shelf) throw badRequest('Shelf not found', 'shelf_not_found');
    if (shelf.tpl.category !== 'shelf') throw placementError(`${shelf.name} is not a shelf`, 'not_a_shelf');
    const slots = shelf.tpl.shelf_slots ?? 1;
    if (p.shelf_slot < 1 || p.shelf_slot > slots) throw placementError(`${shelf.name} has slots 1 to ${slots}`, 'bad_slot', { slots });
    if (tpl.width_fraction > 1 / slots + 1e-6) throw placementError(`This device is too wide for a slot on ${shelf.name}`, 'too_wide');
    if (tpl.height_u > shelf.tpl.height_u) throw placementError(`This device is ${tpl.height_u}U tall and ${shelf.name} is ${shelf.tpl.height_u}U`, 'too_tall');
    const [taken] = await db
      .select({ id: devices.id, name: devices.name })
      .from(devices)
      .where(and(eq(devices.shelf_device_id, p.shelf_device_id), eq(devices.shelf_slot, p.shelf_slot), selfId ? ne(devices.id, selfId) : undefined))
      .limit(1);
    if (taken) throw placementError(`Slot ${p.shelf_slot} on ${shelf.name} already holds ${taken.name}`, 'slot_taken', { with: taken.id });
  }
}
