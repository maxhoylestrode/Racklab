import crypto from 'node:crypto';
import { Router } from 'express';
import { asc, eq, count } from 'drizzle-orm';
import { templateCreateSchema, templateUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah, parse, HttpError, badRequest } from '../errors';
import { deviceTemplates, devices } from '../db/schema';
import { audit } from '../services/audit';
import { idParam, one, defined } from './util';

const slug = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'custom'}_${crypto.randomBytes(3).toString('hex')}`;

function checkLayout(heightU: number, layout: { y: number }[]) {
  const bad = layout.find((p) => p.y > heightU * 100);
  if (bad) throw badRequest(`Port positions must be within 0 to ${heightU * 100} for a ${heightU}U device`, 'port_out_of_bounds');
}

export function templateRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/templates', ah(async (_req, res) => {
    res.json(await db.select().from(deviceTemplates).orderBy(asc(deviceTemplates.is_builtin), asc(deviceTemplates.name)));
  }));

  r.post('/templates', ah(async (req, res) => {
    const body = parse(templateCreateSchema, req.body);
    checkLayout(body.height_u, body.port_layout);
    if (body.category === 'shelf' && !body.shelf_slots) body.shelf_slots = 2;
    const row = one(await db.insert(deviceTemplates).values({ ...body, key: body.key ?? slug(body.name), is_builtin: false }).returning());
    await audit(db, 'template.create', 'template', row.id, row.name);
    res.status(201).json(row);
  }));

  r.patch('/templates/:id', ah(async (req, res) => {
    const id = idParam(req);
    const existing = one(await db.select().from(deviceTemplates).where(eq(deviceTemplates.id, id)));
    if (existing.is_builtin) throw new HttpError(403, 'Built-in templates are read-only. Clone it to edit.', 'builtin_readonly');
    const body = parse(templateUpdateSchema, req.body);
    checkLayout(body.height_u ?? existing.height_u, body.port_layout ?? existing.port_layout);
    if ((body.height_u !== undefined && body.height_u !== existing.height_u) || (body.form_factor && body.form_factor !== existing.form_factor)) {
      const [{ n }] = await db.select({ n: count() }).from(devices).where(eq(devices.template_id, id));
      if (n > 0) throw new HttpError(409, 'Height and form factor cannot change while devices use this template', 'template_in_use');
    }
    const row = one(await db.update(deviceTemplates).set(defined(body)).where(eq(deviceTemplates.id, id)).returning());
    await audit(db, 'template.update', 'template', id, row.name);
    res.json(row);
  }));

  r.delete('/templates/:id', ah(async (req, res) => {
    const id = idParam(req);
    const existing = one(await db.select().from(deviceTemplates).where(eq(deviceTemplates.id, id)));
    if (existing.is_builtin) throw new HttpError(403, 'Built-in templates cannot be deleted', 'builtin_readonly');
    const [{ n }] = await db.select({ n: count() }).from(devices).where(eq(devices.template_id, id));
    if (n > 0) throw new HttpError(409, `This template is used by ${n} device${n === 1 ? '' : 's'}`, 'template_in_use', { devices: n });
    await db.delete(deviceTemplates).where(eq(deviceTemplates.id, id));
    await audit(db, 'template.delete', 'template', id, existing.name);
    res.json({ ok: true });
  }));

  r.post('/templates/:id/clone', ah(async (req, res) => {
    const src = one(await db.select().from(deviceTemplates).where(eq(deviceTemplates.id, idParam(req))));
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 100) : `${src.name} (copy)`;
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = src;
    const row = one(await db.insert(deviceTemplates).values({ ...rest, name, key: slug(name), is_builtin: false }).returning());
    await audit(db, 'template.clone', 'template', row.id, `${src.name} -> ${row.name}`);
    res.status(201).json(row);
  }));

  return r;
}
