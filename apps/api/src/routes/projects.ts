import { Router } from 'express';
import { asc, eq, and, inArray, or, ne, sql, max } from 'drizzle-orm';
import {
  projectCreateSchema, projectUpdateSchema, projectMoveSchema, projectLinkInputSchema, projectTaskCreateSchema, projectTaskUpdateSchema,
  type ProjectStatus,
} from '@rackmap/shared';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { ah, parse, badRequest } from '../errors';
import { projects, projectLinks, projectTasks, devices, services, projectStatuses, projectPriorities } from '../db/schema';
import { audit } from '../services/audit';
import { idParam, one, defined, q } from './util';

type Project = typeof projects.$inferSelect;

/** Loads projects with their links (including linked names) and tasks. */
export async function hydrate(db: DB, rows: Project[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const ls = await db
    .select({
      id: projectLinks.id, project_id: projectLinks.project_id, device_id: projectLinks.device_id, service_id: projectLinks.service_id,
      device_name: devices.name, service_name: services.name, service_device_id: services.device_id,
    })
    .from(projectLinks)
    .leftJoin(devices, eq(projectLinks.device_id, devices.id))
    .leftJoin(services, eq(projectLinks.service_id, services.id))
    .where(inArray(projectLinks.project_id, ids));
  const ts = await db.select().from(projectTasks).where(inArray(projectTasks.project_id, ids)).orderBy(asc(projectTasks.sort_order), asc(projectTasks.created_at));
  return rows.map((p) => {
    const tasks = ts.filter((t) => t.project_id === p.id);
    return {
      ...p,
      links: ls.filter((l) => l.project_id === p.id).map(({ project_id: _p, ...l }) => l),
      tasks,
      task_progress: { done: tasks.filter((t) => t.done).length, total: tasks.length },
    };
  });
}

async function checkLinkTarget(db: DB, link: { device_id?: string; service_id?: string }) {
  if (link.device_id) {
    const [d] = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, link.device_id)).limit(1);
    if (!d) throw badRequest('Linked device does not exist', 'link_target_missing');
  } else if (link.service_id) {
    const [s] = await db.select({ id: services.id }).from(services).where(eq(services.id, link.service_id)).limit(1);
    if (!s) throw badRequest('Linked service does not exist', 'link_target_missing');
  }
}

/** Places `projectId` at `index` within `status`, renumbering that column 0..n-1. */
async function placeInColumn(t: DB, projectId: string, status: ProjectStatus, index: number) {
  const col = await t.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.status, status), ne(projects.id, projectId)))
    .orderBy(asc(projects.sort_order), asc(projects.created_at));
  const ids = col.map((c) => c.id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, projectId);
  for (const [i, id] of ids.entries()) await t.update(projects).set({ sort_order: i }).where(eq(projects.id, id));
}

async function renumber(t: DB, status: ProjectStatus) {
  const col = await t.select({ id: projects.id }).from(projects).where(eq(projects.status, status)).orderBy(asc(projects.sort_order), asc(projects.created_at));
  for (const [i, c] of col.entries()) await t.update(projects).set({ sort_order: i }).where(eq(projects.id, c.id));
}

/** Kind of each status key, for completion rules. Unknown keys are a 400. */
async function statusKinds(t: DB) {
  const rows = await t.select({ key: projectStatuses.key, kind: projectStatuses.kind }).from(projectStatuses).orderBy(asc(projectStatuses.sort_order));
  return { first: rows[0]?.key, kind: (k: string) => {
    const r = rows.find((x) => x.key === k);
    if (!r) throw badRequest(`Unknown status "${k}"`, 'unknown_status');
    return r.kind;
  } };
}
async function checkPriority(t: DB, key: string) {
  const [p] = await t.select({ key: projectPriorities.key }).from(projectPriorities).where(eq(projectPriorities.key, key)).limit(1);
  if (!p) throw badRequest(`Unknown priority "${key}"`, 'unknown_priority');
}
/** The middle level, rounding toward less urgent: Medium for High/Medium/Low and for Urgent/High/Medium/Low. */
async function defaultPriority(t: DB) {
  const rows = await t.select({ key: projectPriorities.key }).from(projectPriorities).orderBy(asc(projectPriorities.sort_order));
  if (!rows.length) throw badRequest('Add a priority level first', 'no_priorities');
  return rows[Math.floor(rows.length / 2)].key;
}
/** Open = not in a done-kind column. */
const notDone = sql`${projects.status} not in (select key from project_statuses where kind = 'done')`;

const completedAtFor = (fromDone: boolean, toDone: boolean, now: Date, prev: Date | null) =>
  toDone ? (fromDone ? prev : now) : null;

export function projectRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  const now = () => new Date(ctx.clock.now());

  r.get('/projects', ah(async (req, res) => {
    const dev = q(req, 'device_id');
    const includeArchived = q(req, 'include_archived') === 'true';
    const openOnly = q(req, 'open') === 'true';
    let idFilter: string[] | null = null;
    if (dev) {
      const svcIds = (await db.select({ id: services.id }).from(services).where(eq(services.device_id, dev))).map((s) => s.id);
      const linked = await db.select({ pid: projectLinks.project_id }).from(projectLinks)
        .where(svcIds.length ? or(eq(projectLinks.device_id, dev), inArray(projectLinks.service_id, svcIds)) : eq(projectLinks.device_id, dev));
      idFilter = [...new Set(linked.map((l) => l.pid))];
      if (idFilter.length === 0) return void res.json([]);
    }
    const rows = await db.select().from(projects).where(and(
      includeArchived ? undefined : eq(projects.archived, false),
      openOnly ? notDone : undefined,
      idFilter ? inArray(projects.id, idFilter) : undefined,
    )).orderBy(asc(projects.status), asc(projects.sort_order));
    res.json(await hydrate(db, rows));
  }));

  /** Open (not complete, not archived) project counts per device, including via its services. For rack badges. */
  r.get('/projects/badges', ah(async (_req, res) => {
    const rows: any = await db.execute(sql`
      select coalesce(pl.device_id, s.device_id) as device_id, count(distinct p.id)::int as open_count
      from project_links pl
      join projects p on p.id = pl.project_id and p.archived = false
      join project_statuses ps on ps.key = p.status and ps.kind <> 'done'
      left join services s on s.id = pl.service_id
      group by 1`);
    res.json(rows.rows ?? rows);
  }));

  r.post('/projects', ah(async (req, res) => {
    const body = parse(projectCreateSchema, req.body);
    const { links: linkInputs, ...rest } = body;
    for (const l of linkInputs) await checkLinkTarget(db, l);
    const row = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const kinds = await statusKinds(t);
      const status = rest.status ?? kinds.first;
      if (!status) throw badRequest('Add a status first', 'no_statuses');
      const done = kinds.kind(status) === 'done';
      const priority = rest.priority ?? await defaultPriority(t);
      await checkPriority(t, priority);
      const fields = { ...rest, status, priority };
      const [{ m }] = await t.select({ m: max(projects.sort_order) }).from(projects).where(eq(projects.status, status));
      const p = one(await t.insert(projects).values({
        ...fields, sort_order: (m ?? -1) + 1, completed_at: done ? now() : null,
      }).returning());
      if (linkInputs.length) await t.insert(projectLinks).values(linkInputs.map((l) => ({ project_id: p.id, device_id: l.device_id ?? null, service_id: l.service_id ?? null })));
      return p;
    });
    await audit(db, 'project.create', 'project', row.id, row.title);
    res.status(201).json((await hydrate(db, [row]))[0]);
  }));

  r.get('/projects/:id', ah(async (req, res) => {
    const row = one(await db.select().from(projects).where(eq(projects.id, idParam(req))));
    res.json((await hydrate(db, [row]))[0]);
  }));

  r.patch('/projects/:id', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(projectUpdateSchema, req.body);
    const row = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const existing = one(await t.select().from(projects).where(eq(projects.id, id)));
      const set: Partial<typeof projects.$inferInsert> = defined(body);
      if (body.priority) await checkPriority(t, body.priority);
      if (body.status && body.status !== existing.status) {
        const kinds = await statusKinds(t);
        set.completed_at = completedAtFor(kinds.kind(existing.status) === 'done', kinds.kind(body.status) === 'done', now(), existing.completed_at);
        const [{ m }] = await t.select({ m: max(projects.sort_order) }).from(projects).where(eq(projects.status, body.status));
        set.sort_order = (m ?? -1) + 1;
      }
      const p = one(await t.update(projects).set(set).where(eq(projects.id, id)).returning());
      if (body.status && body.status !== existing.status) await renumber(t, existing.status);
      return p;
    });
    await audit(db, body.archived === true ? 'project.archive' : 'project.update', 'project', id, row.title);
    res.json((await hydrate(db, [row]))[0]);
  }));

  r.post('/projects/:id/move', ah(async (req, res) => {
    const id = idParam(req);
    const body = parse(projectMoveSchema, req.body);
    const row = await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const existing = one(await t.select().from(projects).where(eq(projects.id, id)));
      const kinds = await statusKinds(t);
      await t.update(projects).set({
        status: body.status,
        completed_at: completedAtFor(kinds.kind(existing.status) === 'done', kinds.kind(body.status) === 'done', now(), existing.completed_at),
      }).where(eq(projects.id, id));
      await placeInColumn(t, id, body.status, body.sort_order);
      if (existing.status !== body.status) await renumber(t, existing.status);
      return one(await t.select().from(projects).where(eq(projects.id, id)));
    });
    await audit(db, 'project.move', 'project', id, `${row.title} -> ${row.status}`);
    res.json((await hydrate(db, [row]))[0]);
  }));

  r.delete('/projects/:id', ah(async (req, res) => {
    const id = idParam(req);
    const row = one(await db.delete(projects).where(eq(projects.id, id)).returning());
    await renumber(db, row.status);
    await audit(db, 'project.delete', 'project', id, row.title);
    res.json({ ok: true });
  }));

  // ---------- links ----------
  r.post('/projects/:id/links', ah(async (req, res) => {
    const id = idParam(req);
    one(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)));
    const body = parse(projectLinkInputSchema, req.body);
    await checkLinkTarget(db, body);
    const dupe = await db.select({ id: projectLinks.id }).from(projectLinks).where(and(
      eq(projectLinks.project_id, id),
      body.device_id ? eq(projectLinks.device_id, body.device_id) : eq(projectLinks.service_id, body.service_id!),
    ));
    if (!dupe.length) await db.insert(projectLinks).values({ project_id: id, device_id: body.device_id ?? null, service_id: body.service_id ?? null });
    await audit(db, 'project.link', 'project', id, body.device_id ? `device ${body.device_id}` : `service ${body.service_id}`);
    const row = one(await db.select().from(projects).where(eq(projects.id, id)));
    res.status(201).json((await hydrate(db, [row]))[0]);
  }));

  r.delete('/projects/:id/links/:linkId', ah(async (req, res) => {
    const id = idParam(req);
    const linkId = idParam(req, 'linkId');
    one(await db.delete(projectLinks).where(and(eq(projectLinks.id, linkId), eq(projectLinks.project_id, id))).returning());
    await audit(db, 'project.unlink', 'project', id);
    const row = one(await db.select().from(projects).where(eq(projects.id, id)));
    res.json((await hydrate(db, [row]))[0]);
  }));

  // ---------- tasks ----------
  r.get('/projects/:id/tasks', ah(async (req, res) => {
    res.json(await db.select().from(projectTasks).where(eq(projectTasks.project_id, idParam(req))).orderBy(asc(projectTasks.sort_order)));
  }));

  r.post('/projects/:id/tasks', ah(async (req, res) => {
    const id = idParam(req);
    one(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)));
    const body = parse(projectTaskCreateSchema, req.body);
    const [{ m }] = await db.select({ m: max(projectTasks.sort_order) }).from(projectTasks).where(eq(projectTasks.project_id, id));
    const row = one(await db.insert(projectTasks).values({ ...body, project_id: id, sort_order: body.sort_order ?? (m ?? -1) + 1 }).returning());
    await db.update(projects).set({ updated_at: now() }).where(eq(projects.id, id));
    res.status(201).json(row);
  }));

  r.patch('/projects/:id/tasks/:taskId', ah(async (req, res) => {
    const id = idParam(req);
    const taskId = idParam(req, 'taskId');
    const body = parse(projectTaskUpdateSchema, req.body);
    const row = one(await db.update(projectTasks).set(defined(body)).where(and(eq(projectTasks.id, taskId), eq(projectTasks.project_id, id))).returning());
    await db.update(projects).set({ updated_at: now() }).where(eq(projects.id, id));
    res.json(row);
  }));

  r.delete('/projects/:id/tasks/:taskId', ah(async (req, res) => {
    const id = idParam(req);
    const taskId = idParam(req, 'taskId');
    one(await db.delete(projectTasks).where(and(eq(projectTasks.id, taskId), eq(projectTasks.project_id, id))).returning());
    res.json({ ok: true });
  }));

  return r;
}
