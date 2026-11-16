import crypto from 'node:crypto';
import { Router } from 'express';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { credentialCreateSchema, credentialUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah, parse, badRequest, notFound } from '../errors';
import { credentials, services, devices } from '../db/schema';
import { audit } from '../services/audit';
import { requireDataKey } from '../services/vault';
import { seal, openString, AD } from '../crypto/vault';
import { idParam, one, q } from './util';

type Cred = typeof credentials.$inferSelect;

/** Public shape of a credential: metadata only, never ciphertext or secrets. */
export function credentialMeta(c: Cred) {
  return {
    id: c.id,
    device_id: c.device_id,
    service_id: c.service_id,
    label: c.label,
    username_plain: c.username_plain,
    url: c.url,
    has_totp: !!c.totp_ciphertext,
    has_notes: !!c.notes_ciphertext,
    last_revealed_at: c.last_revealed_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

const buf = (u: Uint8Array) => Buffer.from(u);

async function sealField(key: Uint8Array, id: string, field: 'secret' | 'totp' | 'notes', value: string) {
  const s = await seal(key, value, AD.field(id, field));
  return { c: buf(s.ciphertext), n: buf(s.nonce) };
}

export function credentialRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  async function checkOwner(deviceId?: string | null, serviceId?: string | null) {
    if (deviceId) one(await db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId)), 'Device not found');
    if (serviceId) one(await db.select({ id: services.id }).from(services).where(eq(services.id, serviceId)), 'Service not found');
  }

  r.get('/credentials', ah(async (req, res) => {
    const dev = q(req, 'device_id');
    let where;
    if (dev) {
      // A device's credentials plus those of every service hosted on it.
      const svcIds = (await db.select({ id: services.id }).from(services).where(eq(services.device_id, dev))).map((s) => s.id);
      where = svcIds.length ? or(eq(credentials.device_id, dev), inArray(credentials.service_id, svcIds)) : eq(credentials.device_id, dev);
    }
    const rows = await db.select().from(credentials).where(where).orderBy(asc(credentials.label));
    res.json(rows.map(credentialMeta));
  }));

  r.post('/credentials', ah(async (req, res) => {
    const body = parse(credentialCreateSchema, req.body);
    await checkOwner(body.device_id, body.service_id);
    const key = requireDataKey(ctx, req);
    const id = crypto.randomUUID();
    const secret = await sealField(key, id, 'secret', body.secret);
    const totp = body.totp_seed ? await sealField(key, id, 'totp', normTotp(body.totp_seed)) : null;
    const pnotes = body.private_notes ? await sealField(key, id, 'notes', body.private_notes) : null;
    const row = one(await db.insert(credentials).values({
      id,
      device_id: body.device_id ?? null,
      service_id: body.service_id ?? null,
      label: body.label,
      username_plain: body.username_plain ?? null,
      url: body.url ?? null,
      secret_ciphertext: secret.c,
      secret_nonce: secret.n,
      totp_ciphertext: totp?.c ?? null,
      totp_nonce: totp?.n ?? null,
      notes_ciphertext: pnotes?.c ?? null,
      notes_nonce: pnotes?.n ?? null,
    }).returning());
    await audit(db, 'credential.create', 'credential', id, row.label);
    res.status(201).json(credentialMeta(row));
  }));

  r.patch('/credentials/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(credentialUpdateSchema, req.body);
    const existing = one(await db.select().from(credentials).where(eq(credentials.id, id)));
    const dev = body.device_id === undefined ? existing.device_id : body.device_id;
    const svc = body.service_id === undefined ? existing.service_id : body.service_id;
    if (dev && svc) throw badRequest('A credential belongs to a device or a service, not both', 'credential_owner');
    await checkOwner(body.device_id, body.service_id);
    const set: Partial<typeof credentials.$inferInsert> = {};
    if (body.label !== undefined) set.label = body.label;
    if (body.username_plain !== undefined) set.username_plain = body.username_plain;
    if (body.url !== undefined) set.url = body.url;
    if (body.device_id !== undefined) set.device_id = body.device_id;
    if (body.service_id !== undefined) set.service_id = body.service_id;
    const touchesSecrets = body.secret !== undefined || body.totp_seed !== undefined || body.private_notes !== undefined;
    if (touchesSecrets) {
      const key = requireDataKey(ctx, req);
      if (body.secret !== undefined) {
        const s = await sealField(key, id, 'secret', body.secret);
        set.secret_ciphertext = s.c; set.secret_nonce = s.n;
      }
      if (body.totp_seed !== undefined) {
        const s = body.totp_seed ? await sealField(key, id, 'totp', normTotp(body.totp_seed)) : null;
        set.totp_ciphertext = s?.c ?? null; set.totp_nonce = s?.n ?? null;
      }
      if (body.private_notes !== undefined) {
        const s = body.private_notes ? await sealField(key, id, 'notes', body.private_notes) : null;
        set.notes_ciphertext = s?.c ?? null; set.notes_nonce = s?.n ?? null;
      }
    }
    const row = Object.keys(set).length ? one(await db.update(credentials).set(set).where(eq(credentials.id, id)).returning()) : existing;
    await audit(db, 'credential.update', 'credential', id, `${row.label}${touchesSecrets ? ' (secret fields changed)' : ''}`);
    res.json(credentialMeta(row));
  }));

  r.delete('/credentials/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(credentials).where(eq(credentials.id, id)).returning());
    await audit(db, 'credential.delete', 'credential', id, row.label);
    res.json({ ok: true });
  }));

  r.post('/credentials/:id/reveal', ah(async (req, res) => {
    const id = idParam(req);
    const key = requireDataKey(ctx, req);
    const [c] = await db.select().from(credentials).where(eq(credentials.id, id)).limit(1);
    if (!c) throw notFound();
    const secret = await openString(key, { ciphertext: c.secret_ciphertext, nonce: c.secret_nonce }, AD.field(id, 'secret'));
    const totp_seed = c.totp_ciphertext && c.totp_nonce
      ? await openString(key, { ciphertext: c.totp_ciphertext, nonce: c.totp_nonce }, AD.field(id, 'totp')) : null;
    const private_notes = c.notes_ciphertext && c.notes_nonce
      ? await openString(key, { ciphertext: c.notes_ciphertext, nonce: c.notes_nonce }, AD.field(id, 'notes')) : null;
    await db.update(credentials).set({ last_revealed_at: new Date(ctx.clock.now()) }).where(eq(credentials.id, id));
    await audit(db, 'credential.reveal', 'credential', id, c.label);
    res.json({ id, secret, totp_seed, private_notes });
  }));

  return r;
}

const normTotp = (s: string) => s.replace(/[\s=]/g, '').toUpperCase();
