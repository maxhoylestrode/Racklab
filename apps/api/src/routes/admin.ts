import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { settingsUpdateSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah, parse } from '../errors';
import { auditLog, appSettings } from '../db/schema';
import { audit } from '../services/audit';
import { exportAll, importAll } from '../services/backup';
import { deleteSeed, hasSeedBeenLoaded } from '../db/seed';
import { applyVaultSettings } from '../services/vault';
import { one, defined } from './util';

export function adminRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/export', ah(async (_req, res) => {
    const data = await exportAll(db);
    await audit(db, 'export', 'lab', null, 'Full JSON export');
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="rackmap-export-${stamp}.json"`);
    res.json(data);
  }));

  r.post('/import', ah(async (req, res) => {
    const counts = await importAll(db, req.body);
    // Imported credentials may be under a different vault key: lock every session's vault.
    ctx.vaultKeys.lockAll();
    await audit(db, 'import', 'lab', null, `Imported ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    res.json({ ok: true, counts });
  }));

  r.get('/audit', ah(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 500));
    res.json(await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit));
  }));

  r.get('/settings', ah(async (_req, res) => {
    const s = one(await db.select().from(appSettings).where(eq(appSettings.id, 1)));
    res.json({ ...s, seed_loaded: await hasSeedBeenLoaded(db), seed_present: await seedPresent() });
  }));

  r.patch('/settings', ah(async (req, res) => {
    const body = parse(settingsUpdateSchema, req.body);
    const s = one(await db.update(appSettings).set(defined(body)).where(eq(appSettings.id, 1)).returning());
    await applyVaultSettings(ctx);
    await audit(db, 'settings.update', 'settings', '1', Object.keys(body).join(', '));
    res.json(s);
  }));

  r.post('/seed/delete', ah(async (_req, res) => {
    res.json({ ok: true, removed: await deleteSeed(db) });
  }));

  async function seedPresent() {
    const rows = await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.action, 'seed.entity')).limit(1);
    return rows.length > 0;
  }

  return r;
}
