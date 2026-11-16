import { Router } from 'express';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { linkCreateSchema, linkUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { ah, parse, HttpError, badRequest } from '../errors';
import { links, ports, devices } from '../db/schema';
import { audit } from '../services/audit';
import { idParam, one, defined } from './util';

export interface LinkWarning { code: 'speed_mismatch'; message: string }

/** Validates the wiring rules (spec 7 and 9). Returns non-fatal warnings. */
export async function checkLink(db: DB, aId: string, bId: string, selfLinkId: string | null = null): Promise<LinkWarning[]> {
  if (aId === bId) throw badRequest('A cable cannot connect a port to itself', 'self_link');
  const ps = await db
    .select({ id: ports.id, label: ports.label, speed: ports.speed_mbps, device_id: ports.device_id, device: devices.name })
    .from(ports)
    .innerJoin(devices, eq(ports.device_id, devices.id))
    .where(inArray(ports.id, [aId, bId]));
  const a = ps.find((p) => p.id === aId);
  const b = ps.find((p) => p.id === bId);
  if (!a || !b) throw badRequest('Port not found', 'port_not_found');
  if (a.device_id === b.device_id) throw badRequest(`Both ports are on ${a.device}. A cable must join two different devices.`, 'same_device');
  const busy = await db.select().from(links).where(or(
    inArray(links.port_a_id, [aId, bId]),
    inArray(links.port_b_id, [aId, bId]),
  ));
  const clash = busy.find((l) => l.id !== selfLinkId);
  if (clash) {
    const which = [clash.port_a_id, clash.port_b_id].includes(aId) ? a : b;
    throw new HttpError(409, `${which.device} ${which.label} already has a cable`, 'port_in_use', { port_id: which.id, link_id: clash.id });
  }
  const warnings: LinkWarning[] = [];
  if (a.speed && b.speed && a.speed !== b.speed) {
    warnings.push({ code: 'speed_mismatch', message: `Speed mismatch: ${a.device} ${a.label} is ${fmt(a.speed)}, ${b.device} ${b.label} is ${fmt(b.speed)}. The link will run at ${fmt(Math.min(a.speed, b.speed))}.` });
  }
  return warnings;
}
const fmt = (mbps: number) => (mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`);

export function linkRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/links', ah(async (_req, res) => {
    res.json(await db.select().from(links).orderBy(asc(links.created_at)));
  }));

  r.post('/links', ah(async (req, res) => {
    const body = parse(linkCreateSchema, req.body);
    const out = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const warnings = await checkLink(t, body.port_a_id, body.port_b_id);
      const row = one(await t.insert(links).values(body).returning());
      return { ...row, warnings };
    });
    await audit(db, 'link.create', 'link', out.id, out.label ?? '');
    res.status(201).json(out);
  }));

  r.patch('/links/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(linkUpdateSchema, req.body);
    const row = one(await db.update(links).set(defined(body)).where(eq(links.id, id)).returning());
    await audit(db, 'link.update', 'link', id, row.label ?? '');
    res.json(row);
  }));

  r.delete('/links/:id', ah(async (req, res) => {
    const id = idParam(req);
    one(await db.delete(links).where(eq(links.id, id)).returning());
    await audit(db, 'link.delete', 'link', id);
    res.json({ ok: true });
  }));

  return r;
}
