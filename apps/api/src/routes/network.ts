import { Router } from 'express';
import { asc, eq, and, ne, sql } from 'drizzle-orm';
import { ipCreateSchema, ipUpdateSchema, vlanCreateSchema, vlanUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { ah, parse, badRequest } from '../errors';
import { ipAddresses, vlans, ports, devices } from '../db/schema';
import { audit } from '../services/audit';
import { idParam, one, defined, q } from './util';

/**
 * IP rows with computed warnings: the same address on another device, and an address
 * outside its VLAN's subnet (Postgres inet containment: address <<= subnet).
 */
export async function listIps(db: DB, deviceId?: string) {
  const rows = await db
    .select({
      ip: ipAddresses,
      device_name: devices.name,
      vlan_number: vlans.vlan_number,
      vlan_name: vlans.name,
      outside_subnet: sql<boolean>`(${vlans.subnet} is not null and not (${ipAddresses.address} <<= ${vlans.subnet}))`,
      duplicate_on: sql<string[] | null>`(
        select array_agg(distinct d2.name) from ip_addresses i2 join devices d2 on d2.id = i2.device_id
        where host(i2.address) = host(${ipAddresses.address}) and i2.device_id <> ${ipAddresses.device_id})`,
    })
    .from(ipAddresses)
    .innerJoin(devices, eq(ipAddresses.device_id, devices.id))
    .leftJoin(vlans, eq(ipAddresses.vlan_id, vlans.id))
    .where(deviceId ? eq(ipAddresses.device_id, deviceId) : undefined)
    .orderBy(sql`${ipAddresses.address} asc`);
  return rows.map((r) => {
    const warnings: { code: string; message: string }[] = [];
    if (r.duplicate_on?.length) warnings.push({ code: 'duplicate_ip', message: `Also assigned to ${r.duplicate_on.join(', ')}` });
    if (r.outside_subnet) warnings.push({ code: 'outside_vlan_subnet', message: `Outside the subnet of VLAN ${r.vlan_number} (${r.vlan_name})` });
    return { ...r.ip, address: hostOnly(r.ip.address), device_name: r.device_name, vlan_number: r.vlan_number, warnings };
  });
}
const hostOnly = (a: string) => a.replace(/\/(32|128)$/, '');

async function checkIpRefs(db: DB, deviceId: string, portId?: string | null) {
  if (!portId) return;
  const [p] = await db.select().from(ports).where(eq(ports.id, portId)).limit(1);
  if (!p || p.device_id !== deviceId) throw badRequest('That port is not on this device', 'port_mismatch');
}

/** Only one primary IP per device. */
async function clearOtherPrimaries(db: DB, deviceId: string, keepId: string) {
  await db.update(ipAddresses).set({ is_primary: false }).where(and(eq(ipAddresses.device_id, deviceId), ne(ipAddresses.id, keepId)));
}

export function networkRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/ip-addresses', ah(async (req, res) => {
    res.json(await listIps(db, q(req, 'device_id')));
  }));

  r.post('/ip-addresses', ah(async (req, res) => {
    const body = parse(ipCreateSchema, req.body);
    await checkIpRefs(db, body.device_id, body.port_id);
    const row = one(await db.insert(ipAddresses).values(body).returning());
    if (row.is_primary) await clearOtherPrimaries(db, row.device_id, row.id);
    await audit(db, 'ip.create', 'ip_address', row.id, hostOnly(row.address));
    res.status(201).json((await listIps(db, row.device_id)).find((x) => x.id === row.id));
  }));

  r.get('/ip-addresses/:id', ah(async (req, res) => {
    const row = one(await db.select().from(ipAddresses).where(eq(ipAddresses.id, idParam(req))));
    res.json((await listIps(db, row.device_id)).find((x) => x.id === row.id));
  }));

  r.patch('/ip-addresses/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(ipUpdateSchema, req.body);
    const existing = one(await db.select().from(ipAddresses).where(eq(ipAddresses.id, id)));
    await checkIpRefs(db, body.device_id ?? existing.device_id, body.port_id === undefined ? existing.port_id : body.port_id);
    const row = one(await db.update(ipAddresses).set(defined(body)).where(eq(ipAddresses.id, id)).returning());
    if (row.is_primary) await clearOtherPrimaries(db, row.device_id, row.id);
    await audit(db, 'ip.update', 'ip_address', id, hostOnly(row.address));
    res.json((await listIps(db, row.device_id)).find((x) => x.id === row.id));
  }));

  r.delete('/ip-addresses/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(ipAddresses).where(eq(ipAddresses.id, id)).returning());
    await audit(db, 'ip.delete', 'ip_address', id, hostOnly(row.address));
    res.json({ ok: true });
  }));

  r.get('/vlans', ah(async (_req, res) => {
    res.json(await db.select().from(vlans).orderBy(asc(vlans.vlan_number)));
  }));
  r.post('/vlans', ah(async (req, res) => {
    const body = parse(vlanCreateSchema, req.body);
    const row = one(await db.insert(vlans).values(body).returning());
    await audit(db, 'vlan.create', 'vlan', row.id, `${row.vlan_number} ${row.name}`);
    res.status(201).json(row);
  }));
  r.get('/vlans/:id', ah(async (req, res) => {
    res.json(one(await db.select().from(vlans).where(eq(vlans.id, idParam(req)))));
  }));
  r.patch('/vlans/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(vlanUpdateSchema, req.body);
    const row = one(await db.update(vlans).set(defined(body)).where(eq(vlans.id, id)).returning());
    await audit(db, 'vlan.update', 'vlan', id, `${row.vlan_number} ${row.name}`);
    res.json(row);
  }));
  r.delete('/vlans/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(vlans).where(eq(vlans.id, id)).returning());
    await audit(db, 'vlan.delete', 'vlan', id, `${row.vlan_number} ${row.name}`);
    res.json({ ok: true });
  }));

  return r;
}
