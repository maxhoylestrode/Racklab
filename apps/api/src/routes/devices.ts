import { Router } from 'express';
import { asc, eq, inArray } from 'drizzle-orm';
import { deviceCreateSchema, deviceUpdateSchema, deviceMoveSchema, portUpdateSchema, type PortLayoutEntry } from '@rackmap/shared';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { ah, parse, badRequest } from '../errors';
import { devices, deviceTemplates, ports, links } from '../db/schema';
import { audit } from '../services/audit';
import { normalisePlacement, validatePlacement, type Placement } from '../services/placement';
import { idParam, one, defined } from './util';

type PortRow = typeof ports.$inferSelect;

function portsFromLayout(deviceId: string, layout: PortLayoutEntry[]) {
  return layout.map((p, i) => ({
    device_id: deviceId,
    label: p.label,
    kind: p.kind,
    speed_mbps: p.speed_mbps,
    poe: p.poe,
    position_index: i,
    layout_x: p.x,
    layout_y: p.y,
    group: p.group ?? null,
  }));
}

async function getTemplate(db: DB, id: string) {
  const [t] = await db.select().from(deviceTemplates).where(eq(deviceTemplates.id, id)).limit(1);
  if (!t) throw badRequest('Template not found', 'template_not_found');
  return t;
}

async function withPorts(db: DB, rows: (typeof devices.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ps = await db.select().from(ports).where(inArray(ports.device_id, rows.map((d) => d.id))).orderBy(asc(ports.position_index));
  const by = new Map<string, PortRow[]>();
  for (const p of ps) (by.get(p.device_id) ?? by.set(p.device_id, []).get(p.device_id)!).push(p);
  return rows.map((d) => ({ ...d, ports: by.get(d.id) ?? [] }));
}

export async function createDevice(db: DB, body: ReturnType<typeof deviceCreateSchema.parse>) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const tpl = await getTemplate(t, body.template_id);
    const placement = normalisePlacement(tpl, body);
    await validatePlacement(t, tpl, placement, null);
    const { rack_id: _a, rack_unit_start: _b, shelf_device_id: _c, shelf_slot: _d, ...rest } = body;
    const dev = one(await t.insert(devices).values({ ...rest, ...placement }).returning());
    const newPorts = portsFromLayout(dev.id, tpl.port_layout);
    const ps = newPorts.length ? await t.insert(ports).values(newPorts).returning() : [];
    return { ...dev, ports: ps };
  });
}

export function deviceRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/devices', ah(async (_req, res) => {
    const rows = await db.select().from(devices).orderBy(asc(devices.name));
    res.json(await withPorts(db, rows));
  }));

  r.post('/devices', ah(async (req, res) => {
    const body = parse(deviceCreateSchema, req.body);
    const dev = await createDevice(db, body);
    await audit(db, 'device.create', 'device', dev.id, dev.name);
    res.status(201).json(dev);
  }));

  r.get('/devices/:id', ah(async (req, res) => {
    const rows = await db.select().from(devices).where(eq(devices.id, idParam(req)));
    res.json(one(await withPorts(db, [one(rows)])));
  }));

  r.patch('/devices/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(deviceUpdateSchema, req.body);
    const out = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const existing = one(await t.select().from(devices).where(eq(devices.id, id)));
      const templateChanged = body.template_id !== undefined && body.template_id !== existing.template_id;
      const placementTouched = ['rack_id', 'rack_unit_start', 'shelf_device_id', 'shelf_slot'].some((k) => k in body);
      const tpl = await getTemplate(t, body.template_id ?? existing.template_id);
      if (templateChanged || placementTouched) {
        const placement = normalisePlacement(tpl, placementTouched ? { ...pick(existing), ...pickDefined(body) } : pick(existing));
        await validatePlacement(t, tpl, placement, id);
        Object.assign(body, placement);
      }
      if (templateChanged) {
        const oldTpl = await getTemplate(t, existing.template_id);
        if (oldTpl.category === 'shelf' && tpl.category !== 'shelf') {
          await t.update(devices).set({ shelf_device_id: null, shelf_slot: null }).where(eq(devices.shelf_device_id, id));
        }
        await regeneratePorts(t, id, tpl.port_layout);
      }
      return one(await t.update(devices).set(defined(body)).where(eq(devices.id, id)).returning());
    });
    await audit(db, 'device.update', 'device', id, out.name);
    res.json(one(await withPorts(db, [out])));
  }));

  r.post('/devices/:id/move', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(deviceMoveSchema, req.body);
    const out = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const existing = one(await t.select().from(devices).where(eq(devices.id, id)));
      const tpl = await getTemplate(t, existing.template_id);
      const placement = normalisePlacement(tpl, body);
      await validatePlacement(t, tpl, placement, id);
      return one(await t.update(devices).set(placement).where(eq(devices.id, id)).returning());
    });
    await audit(db, 'device.move', 'device', id, describePlacement(out));
    res.json(out);
  }));

  r.post('/devices/:id/duplicate', ah(async (req, res) => {
    const src = one(await db.select().from(devices).where(eq(devices.id, idParam(req))));
    const srcPorts = await db.select().from(ports).where(eq(ports.device_id, src.id)).orderBy(asc(ports.position_index));
    const dup = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = src;
      const d = one(await t.insert(devices).values({
        ...rest, name: `${src.name} copy`, rack_id: null, rack_unit_start: null, shelf_device_id: null, shelf_slot: null,
      }).returning());
      const ps = srcPorts.length
        ? await t.insert(ports).values(srcPorts.map(({ id: _x, created_at: _y, updated_at: _z, ...p }) => ({ ...p, device_id: d.id }))).returning()
        : [];
      return { ...d, ports: ps };
    });
    await audit(db, 'device.duplicate', 'device', dup.id, `${src.name} -> ${dup.name}`);
    res.status(201).json(dup);
  }));

  r.delete('/devices/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(devices).where(eq(devices.id, id)).returning());
    await audit(db, 'device.delete', 'device', id, row.name);
    res.json({ ok: true });
  }));

  r.get('/devices/:id/ports', ah(async (req, res) => {
    const id = idParam(req);
    one(await db.select({ id: devices.id }).from(devices).where(eq(devices.id, id)));
    res.json(await db.select().from(ports).where(eq(ports.device_id, id)).orderBy(asc(ports.position_index)));
  }));

  r.patch('/ports/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(portUpdateSchema, req.body);
    const row = one(await db.update(ports).set(defined(body)).where(eq(ports.id, id)).returning());
    await audit(db, 'port.update', 'port', id, row.label);
    res.json(row);
  }));

  return r;
}

const pick = (d: Placement): Placement => ({
  rack_id: d.rack_id, rack_unit_start: d.rack_unit_start, shelf_device_id: d.shelf_device_id, shelf_slot: d.shelf_slot,
});
const pickDefined = (b: Partial<Placement>): Partial<Placement> => {
  const out: Record<string, unknown> = {};
  for (const k of ['rack_id', 'rack_unit_start', 'shelf_device_id', 'shelf_slot'] as const) if (k in b) out[k] = b[k] ?? null;
  return out as Partial<Placement>;
};

function describePlacement(d: Placement): string {
  if (d.rack_unit_start) return `U${d.rack_unit_start}`;
  if (d.shelf_device_id) return `shelf slot ${d.shelf_slot}`;
  return 'unracked';
}

/** Rebuilds a device's ports from a new template, keeping ports (and their links) whose labels match. */
async function regeneratePorts(t: DB, deviceId: string, layout: PortLayoutEntry[]) {
  const existing = await t.select().from(ports).where(eq(ports.device_id, deviceId));
  const byLabel = new Map(existing.map((p) => [p.label, p]));
  const keep = new Set<string>();
  for (const [i, p] of layout.entries()) {
    const match = byLabel.get(p.label);
    if (match) {
      keep.add(match.id);
      await t.update(ports).set({ kind: p.kind, speed_mbps: p.speed_mbps, poe: p.poe, position_index: i, layout_x: p.x, layout_y: p.y, group: p.group ?? null }).where(eq(ports.id, match.id));
    } else {
      await t.insert(ports).values(portsFromLayout(deviceId, [p]).map((x) => ({ ...x, position_index: i })));
    }
  }
  const drop = existing.filter((p) => !keep.has(p.id)).map((p) => p.id);
  if (drop.length) {
    await t.delete(links).where(inArray(links.port_a_id, drop));
    await t.delete(links).where(inArray(links.port_b_id, drop));
    await t.delete(ports).where(inArray(ports.id, drop));
  }
}
