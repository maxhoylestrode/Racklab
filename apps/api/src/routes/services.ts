import { Router } from 'express';
import { asc, eq, sql, or, isNull, and, desc } from 'drizzle-orm';
import { serviceCreateSchema, serviceUpdateSchema, noteCreateSchema, noteUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { ah, parse, badRequest } from '../errors';
import { services, notes, devices, ipAddresses } from '../db/schema';
import { audit } from '../services/audit';
import { idParam, one, defined, q } from './util';

type Service = typeof services.$inferSelect;
export type ServiceNode = Service & { children: ServiceNode[] };

export function buildTree(rows: Service[]): ServiceNode[] {
  const nodes = new Map(rows.map((s) => [s.id, { ...s, children: [] as ServiceNode[] }]));
  const roots: ServiceNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parent_service_id ? nodes.get(n.parent_service_id) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (xs: ServiceNode[]) => {
    xs.sort((a, b) => a.sort_order - b.sort_order || (a.vmid_or_ctid ?? 0) - (b.vmid_or_ctid ?? 0) || a.name.localeCompare(b.name));
    xs.forEach((x) => sort(x.children));
  };
  sort(roots);
  return roots;
}

/** Parent must be on the same device and must not be the service itself or one of its descendants. */
async function checkParent(db: DB, deviceId: string, parentId: string | null | undefined, selfId: string | null) {
  if (!parentId) return;
  if (parentId === selfId) throw badRequest('A service cannot contain itself', 'service_cycle');
  const all = await db.select({ id: services.id, parent: services.parent_service_id, device_id: services.device_id }).from(services).where(eq(services.device_id, deviceId));
  const parent = all.find((s) => s.id === parentId);
  if (!parent) throw badRequest('The parent service must be on the same device', 'parent_mismatch');
  if (selfId) {
    const byId = new Map(all.map((s) => [s.id, s]));
    for (let cur: string | null = parentId, guard = 0; cur && guard < 1000; cur = byId.get(cur)?.parent ?? null, guard++) {
      if (cur === selfId) throw badRequest('That would put a service inside its own child', 'service_cycle');
    }
  }
}

async function checkServiceIp(db: DB, deviceId: string, ipId: string | null | undefined) {
  if (!ipId) return;
  const [ip] = await db.select().from(ipAddresses).where(eq(ipAddresses.id, ipId)).limit(1);
  if (!ip || ip.device_id !== deviceId) throw badRequest('That IP is not assigned to this device', 'ip_mismatch');
}

export function serviceRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/services', ah(async (req, res) => {
    const dev = q(req, 'device_id');
    res.json(await db.select().from(services).where(dev ? eq(services.device_id, dev) : undefined).orderBy(asc(services.sort_order), asc(services.name)));
  }));

  r.get('/devices/:id/services', ah(async (req, res) => {
    const id = idParam(req);
    one(await db.select({ id: devices.id }).from(devices).where(eq(devices.id, id)));
    res.json(buildTree(await db.select().from(services).where(eq(services.device_id, id))));
  }));

  r.post('/services', ah(async (req, res) => {
    const body = parse(serviceCreateSchema, req.body);
    one(await db.select({ id: devices.id }).from(devices).where(eq(devices.id, body.device_id)), 'Device not found');
    await checkParent(db, body.device_id, body.parent_service_id, null);
    await checkServiceIp(db, body.device_id, body.ip_address_id);
    const row = one(await db.insert(services).values(body).returning());
    await audit(db, 'service.create', 'service', row.id, row.name);
    res.status(201).json(row);
  }));

  r.get('/services/:id', ah(async (req, res) => {
    res.json(one(await db.select().from(services).where(eq(services.id, idParam(req)))));
  }));

  r.patch('/services/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(serviceUpdateSchema, req.body);
    const existing = one(await db.select().from(services).where(eq(services.id, id)));
    const deviceId = body.device_id ?? existing.device_id;
    if (body.device_id && body.device_id !== existing.device_id && body.parent_service_id === undefined) body.parent_service_id = null;
    if (body.parent_service_id !== undefined) await checkParent(db, deviceId, body.parent_service_id, id);
    if (body.ip_address_id !== undefined) await checkServiceIp(db, deviceId, body.ip_address_id);
    const row = one(await db.update(services).set(defined(body)).where(eq(services.id, id)).returning());
    if (body.device_id && body.device_id !== existing.device_id) {
      // Children move with their parent.
      await db.execute(sql`with recursive sub as (select id from services where parent_service_id = ${id} union all select s.id from services s join sub on s.parent_service_id = sub.id) update services set device_id = ${body.device_id} where id in (select id from sub)`);
    }
    await audit(db, 'service.update', 'service', id, row.name);
    res.json(row);
  }));

  r.delete('/services/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(services).where(eq(services.id, id)).returning());
    await audit(db, 'service.delete', 'service', id, row.name);
    res.json({ ok: true });
  }));

  // ---------- notes ----------
  r.get('/notes', ah(async (req, res) => {
    const dev = q(req, 'device_id');
    const svc = q(req, 'service_id');
    const scope = q(req, 'scope'); // 'global' = notes with no owner
    const text = q(req, 'q');
    const where = and(
      dev ? eq(notes.device_id, dev) : undefined,
      svc ? eq(notes.service_id, svc) : undefined,
      scope === 'global' ? and(isNull(notes.device_id), isNull(notes.service_id)) : undefined,
      text
        ? or(
          sql`to_tsvector('simple', ${notes.title} || ' ' || ${notes.body_markdown}) @@ websearch_to_tsquery('simple', ${text})`,
          sql`${notes.title} ilike ${'%' + escapeLike(text) + '%'}`,
          sql`${notes.body_markdown} ilike ${'%' + escapeLike(text) + '%'}`,
        )
        : undefined,
    );
    res.json(await db.select().from(notes).where(where).orderBy(desc(notes.pinned), desc(notes.updated_at)));
  }));

  r.post('/notes', ah(async (req, res) => {
    const body = parse(noteCreateSchema, req.body);
    const row = one(await db.insert(notes).values(body).returning());
    await audit(db, 'note.create', 'note', row.id, row.title);
    res.status(201).json(row);
  }));

  r.get('/notes/:id', ah(async (req, res) => {
    res.json(one(await db.select().from(notes).where(eq(notes.id, idParam(req)))));
  }));

  r.patch('/notes/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(noteUpdateSchema, req.body);
    const existing = one(await db.select().from(notes).where(eq(notes.id, id)));
    const dev = body.device_id === undefined ? existing.device_id : body.device_id;
    const svc = body.service_id === undefined ? existing.service_id : body.service_id;
    if (dev && svc) throw badRequest('A note belongs to a device or a service, not both', 'note_owner');
    const row = one(await db.update(notes).set(defined(body)).where(eq(notes.id, id)).returning());
    await audit(db, 'note.update', 'note', id, row.title);
    res.json(row);
  }));

  r.delete('/notes/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(notes).where(eq(notes.id, id)).returning());
    await audit(db, 'note.delete', 'note', id, row.title);
    res.json({ ok: true });
  }));

  return r;
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
