import { Router, type Request } from 'express';
import { asc, eq, and, inArray, isNull, ne, sql, max } from 'drizzle-orm';
import {
  projectStatusCreateSchema, projectStatusUpdateSchema, projectPriorityCreateSchema, projectPriorityUpdateSchema,
  projectMetaReorderSchema, projectTagColorSchema, type ProjectMeta,
} from '@rackmap/shared';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { ah, parse, badRequest, notFound } from '../errors';
import { projects, projectStatuses, projectPriorities, projectTagColors } from '../db/schema';
import { audit } from '../services/audit';
import { one, defined, q } from './util';

export const MAX_STATUSES = 12;
export const MAX_PRIORITIES = 10;

export async function loadMeta(db: DB): Promise<ProjectMeta> {
  const [statuses, priorities, tag_colors] = await Promise.all([
    db.select({ key: projectStatuses.key, label: projectStatuses.label, color: projectStatuses.color, kind: projectStatuses.kind, sort_order: projectStatuses.sort_order })
      .from(projectStatuses).orderBy(asc(projectStatuses.sort_order), asc(projectStatuses.created_at)),
    db.select({ key: projectPriorities.key, label: projectPriorities.label, color: projectPriorities.color, sort_order: projectPriorities.sort_order })
      .from(projectPriorities).orderBy(asc(projectPriorities.sort_order), asc(projectPriorities.created_at)),
    db.select({ name: projectTagColors.name, color: projectTagColors.color }).from(projectTagColors).orderBy(asc(projectTagColors.name)),
  ]);
  return { statuses: statuses as ProjectMeta['statuses'], priorities, tag_colors };
}

/** Stable key from a label: "Waiting on parts" -> "waiting-on-parts-3f2a". Only used at creation; renames keep the key. */
function makeKey(label: string): string {
  const slug = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'item';
  return `${slug}-${Math.random().toString(16).slice(2, 6)}`;
}

const keyParam = (req: Request): string => {
  const k = String(req.params.key ?? '');
  if (!k || k.length > 40) throw notFound();
  return k;
};

/** Gives `keys` sort_order 0..n-1. The list must be exactly the current set. */
async function reorder(t: DB, table: typeof projectStatuses | typeof projectPriorities, keys: string[]) {
  const have = (await t.select({ key: table.key }).from(table)).map((r) => r.key).sort();
  if (new Set(keys).size !== keys.length || have.join('\n') !== [...keys].sort().join('\n')) throw badRequest('Send every key exactly once', 'reorder_mismatch');
  for (const [i, key] of keys.entries()) await t.update(table).set({ sort_order: i }).where(eq(table.key, key));
}

export function projectMetaRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  const now = () => new Date(ctx.clock.now());

  r.get('/project-meta', ah(async (_req, res) => { res.json(await loadMeta(db)); }));

  // ---------- statuses (board columns) ----------
  r.post('/project-meta/statuses', ah(async (req, res) => {
    const body = parse(projectStatusCreateSchema, req.body);
    const [{ n, m }] = await db.select({ n: sql<number>`count(*)::int`, m: max(projectStatuses.sort_order) }).from(projectStatuses);
    if (Number(n) >= MAX_STATUSES) throw badRequest(`Up to ${MAX_STATUSES} statuses`, 'too_many');
    const row = one(await db.insert(projectStatuses).values({ ...body, key: makeKey(body.label), sort_order: (m ?? -1) + 1 }).returning());
    await audit(db, 'project_status.create', 'project_status', row.key, row.label);
    res.status(201).json(await loadMeta(db));
  }));

  r.patch('/project-meta/statuses/:key', ah(async (req, res) => {
    const key = keyParam(req);
    const body = parse(projectStatusUpdateSchema, req.body);
    await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const existing = one(await t.select().from(projectStatuses).where(eq(projectStatuses.key, key)));
      await t.update(projectStatuses).set(defined(body)).where(eq(projectStatuses.key, key));
      // Becoming (or ceasing to be) a done column completes (or reopens) the projects in it.
      if (body.kind && (body.kind === 'done') !== (existing.kind === 'done')) {
        if (body.kind === 'done') await t.update(projects).set({ completed_at: now() }).where(and(eq(projects.status, key), isNull(projects.completed_at)));
        else await t.update(projects).set({ completed_at: null }).where(eq(projects.status, key));
      }
    });
    await audit(db, 'project_status.update', 'project_status', key, Object.keys(body).join(', '));
    res.json(await loadMeta(db));
  }));

  r.put('/project-meta/statuses/order', ah(async (req, res) => {
    const { keys } = parse(projectMetaReorderSchema, req.body);
    await db.transaction(async (tx) => reorder(tx as unknown as DB, projectStatuses, keys));
    res.json(await loadMeta(db));
  }));

  /** ?reassign_to=<key> moves the status's projects (archived too) into another column first. */
  r.delete('/project-meta/statuses/:key', ah(async (req, res) => {
    const key = keyParam(req);
    const to = q(req, 'reassign_to');
    await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      one(await t.select().from(projectStatuses).where(eq(projectStatuses.key, key)));
      const others = await t.select().from(projectStatuses).where(ne(projectStatuses.key, key));
      if (!others.length) throw badRequest('Keep at least one status', 'last_status');
      const used = await t.select({ id: projects.id }).from(projects).where(eq(projects.status, key)).orderBy(asc(projects.sort_order));
      if (used.length) {
        const target = others.find((o) => o.key === to);
        if (!target) throw badRequest('Choose where its projects should go', 'reassign_required', { count: used.length });
        const [{ m }] = await t.select({ m: max(projects.sort_order) }).from(projects).where(eq(projects.status, target.key));
        const ids = used.map((u) => u.id);
        await t.update(projects).set({
          status: target.key,
          sort_order: sql`${(m ?? -1) + 1} + ${projects.sort_order}`,
          completed_at: target.kind === 'done' ? sql`coalesce(${projects.completed_at}, ${now().toISOString()}::timestamptz)` : null,
        }).where(inArray(projects.id, ids));
      }
      await t.delete(projectStatuses).where(eq(projectStatuses.key, key));
    });
    await audit(db, 'project_status.delete', 'project_status', key, to ? `projects moved to ${to}` : '');
    res.json(await loadMeta(db));
  }));

  // ---------- priorities ----------
  r.post('/project-meta/priorities', ah(async (req, res) => {
    const body = parse(projectPriorityCreateSchema, req.body);
    const [{ n, m }] = await db.select({ n: sql<number>`count(*)::int`, m: max(projectPriorities.sort_order) }).from(projectPriorities);
    if (Number(n) >= MAX_PRIORITIES) throw badRequest(`Up to ${MAX_PRIORITIES} priorities`, 'too_many');
    const row = one(await db.insert(projectPriorities).values({ ...body, key: makeKey(body.label), sort_order: (m ?? -1) + 1 }).returning());
    await audit(db, 'project_priority.create', 'project_priority', row.key, row.label);
    res.status(201).json(await loadMeta(db));
  }));

  r.patch('/project-meta/priorities/:key', ah(async (req, res) => {
    const key = keyParam(req);
    const body = parse(projectPriorityUpdateSchema, req.body);
    one(await db.update(projectPriorities).set(defined(body)).where(eq(projectPriorities.key, key)).returning());
    await audit(db, 'project_priority.update', 'project_priority', key, Object.keys(body).join(', '));
    res.json(await loadMeta(db));
  }));

  r.put('/project-meta/priorities/order', ah(async (req, res) => {
    const { keys } = parse(projectMetaReorderSchema, req.body);
    await db.transaction(async (tx) => reorder(tx as unknown as DB, projectPriorities, keys));
    res.json(await loadMeta(db));
  }));

  r.delete('/project-meta/priorities/:key', ah(async (req, res) => {
    const key = keyParam(req);
    const to = q(req, 'reassign_to');
    await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      one(await t.select().from(projectPriorities).where(eq(projectPriorities.key, key)));
      const others = await t.select().from(projectPriorities).where(ne(projectPriorities.key, key));
      if (!others.length) throw badRequest('Keep at least one priority', 'last_priority');
      const used = await t.select({ id: projects.id }).from(projects).where(eq(projects.priority, key));
      if (used.length) {
        if (!others.some((o) => o.key === to)) throw badRequest('Choose a priority for its projects', 'reassign_required', { count: used.length });
        await t.update(projects).set({ priority: to! }).where(eq(projects.priority, key));
      }
      await t.delete(projectPriorities).where(eq(projectPriorities.key, key));
    });
    await audit(db, 'project_priority.delete', 'project_priority', key, to ? `projects moved to ${to}` : '');
    res.json(await loadMeta(db));
  }));

  // ---------- tag colours ----------
  const tagName = (req: Request) => {
    const n = String(req.params.name ?? '').trim();
    if (!n || n.length > 40) throw notFound();
    return n;
  };
  r.put('/project-meta/tags/:name', ah(async (req, res) => {
    const name = tagName(req);
    const { color } = parse(projectTagColorSchema, req.body);
    await db.insert(projectTagColors).values({ name, color }).onConflictDoUpdate({ target: projectTagColors.name, set: { color, updated_at: now() } });
    res.json(await loadMeta(db));
  }));
  r.delete('/project-meta/tags/:name', ah(async (req, res) => {
    await db.delete(projectTagColors).where(eq(projectTagColors.name, tagName(req)));
    res.json(await loadMeta(db));
  }));

  return r;
}
