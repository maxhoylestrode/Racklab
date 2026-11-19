import { Router } from 'express';
import { asc, sql } from 'drizzle-orm';
import type { InventoryRow } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah } from '../errors';
import { devices } from '../db/schema';
import { listIps } from './network';

/**
 * Per-device extras for the Inventory table: primary IP (with duplicate / subnet warnings), whether any of the
 * device's addresses has a conflict, open project count and credential count. Every field is listed explicitly:
 * no credential label, username, URL or secret is ever part of this payload, only a count.
 */
export function inventoryRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/inventory', ah(async (_req, res) => {
    const [devs, ips, projectRows, credRows] = await Promise.all([
      db.select({ id: devices.id }).from(devices).orderBy(asc(devices.name)),
      listIps(db),
      db.execute(sql`
        select coalesce(pl.device_id, s.device_id) as device_id, count(distinct p.id)::int as n
        from project_links pl
        join projects p on p.id = pl.project_id and p.archived = false
        join project_statuses ps on ps.key = p.status and ps.kind <> 'done'
        left join services s on s.id = pl.service_id
        group by 1`),
      db.execute(sql`
        select coalesce(c.device_id, s.device_id) as device_id, count(*)::int as n
        from credentials c left join services s on s.id = c.service_id
        group by 1`),
    ]);
    const counts = (x: unknown): Map<string, number> => new Map(((x as any).rows ?? (x as any[])).map((row: { device_id: string; n: number }) => [row.device_id, Number(row.n)] as const));
    const projects = counts(projectRows), creds = counts(credRows);
    const byDevice = new Map<string, typeof ips>();
    for (const ip of ips) (byDevice.get(ip.device_id) ?? byDevice.set(ip.device_id, []).get(ip.device_id)!).push(ip);

    const rows: InventoryRow[] = devs.map(({ id }) => {
      const mine = byDevice.get(id) ?? [];
      const p = mine.find((i) => i.is_primary) ?? mine[0];
      return {
        device_id: id,
        primary_ip: p ? { id: p.id, address: p.address, prefix_length: p.prefix_length, is_primary: p.is_primary, vlan_number: p.vlan_number, warnings: p.warnings } : null,
        ip_count: mine.length,
        ip_conflict: mine.some((i) => i.warnings.length > 0),
        open_projects: projects.get(id) ?? 0,
        credential_count: creds.get(id) ?? 0,
      };
    });
    res.json(rows);
  }));

  return r;
}
