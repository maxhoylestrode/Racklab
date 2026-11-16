import { Router } from 'express';
import { asc, eq, and, isNotNull } from 'drizzle-orm';
import { rackCreateSchema, rackUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah, parse, HttpError } from '../errors';
import { racks, devices, deviceTemplates } from '../db/schema';
import { audit } from '../services/audit';
import { idParam, one, defined } from './util';

export function rackRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/racks', ah(async (_req, res) => {
    res.json(await db.select().from(racks).orderBy(asc(racks.created_at)));
  }));

  r.post('/racks', ah(async (req, res) => {
    const body = parse(rackCreateSchema, req.body);
    const row = one(await db.insert(racks).values(body).returning());
    await audit(db, 'rack.create', 'rack', row.id, row.name);
    res.status(201).json(row);
  }));

  r.get('/racks/:id', ah(async (req, res) => {
    res.json(one(await db.select().from(racks).where(eq(racks.id, idParam(req)))));
  }));

  r.patch('/racks/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(rackUpdateSchema, req.body);
    one(await db.select().from(racks).where(eq(racks.id, id)));
    if (body.total_units !== undefined) {
      // Shrinking the rack may not cut off a device.
      const placed = await db
        .select({ name: devices.name, start: devices.rack_unit_start, h: deviceTemplates.height_u })
        .from(devices)
        .innerJoin(deviceTemplates, eq(devices.template_id, deviceTemplates.id))
        .where(and(eq(devices.rack_id, id), isNotNull(devices.rack_unit_start)));
      const over = placed.find((d) => d.start! + d.h - 1 > body.total_units!);
      if (over) throw new HttpError(409, `${over.name} would extend past the top of the rack`, 'out_of_rack');
    }
    const row = one(await db.update(racks).set(defined(body)).where(eq(racks.id, id)).returning());
    await audit(db, 'rack.update', 'rack', id, row.name);
    res.json(row);
  }));

  r.delete('/racks/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(racks).where(eq(racks.id, id)).returning());
    await audit(db, 'rack.delete', 'rack', id, row.name);
    res.json({ ok: true });
  }));

  return r;
}
