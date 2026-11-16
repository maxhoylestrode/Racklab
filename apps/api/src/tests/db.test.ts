import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDb, type DbHandle } from '../db/client';
import { ensureBuiltins } from '../db/bootstrap';
import { deviceTemplates } from '../db/schema';
import { BUILTIN_TEMPLATES } from '../db/templates';

let h: DbHandle;
beforeAll(async () => {
  h = await openDb({ memory: true });
});
afterAll(async () => h.close());

describe('database', () => {
  it('migrates a fresh database cleanly', async () => {
    const res: any = await h.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = (res.rows ?? res).map((r: any) => r.table_name);
    for (const t of ['racks', 'device_templates', 'devices', 'ports', 'links', 'ip_addresses', 'vlans', 'services', 'notes',
      'credentials', 'vault_meta', 'app_user', 'audit_log', 'projects', 'project_links', 'project_tasks']) {
      expect(names).toContain(t);
    }
  });

  it('seeds every built-in template, idempotently', async () => {
    await ensureBuiltins(h.db);
    await ensureBuiltins(h.db);
    const rows = await h.db.select().from(deviceTemplates);
    expect(rows).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(rows.every((r) => r.is_builtin)).toBe(true);
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual([
      'dell_r420', 'dell_r720', 'generic_custom', 'generic_router', 'laptop', 'patch_panel_24', 'raspberry_pi_4',
      'shelf_1u', 'shelf_2u', 'switch_24_port', 'switch_8_port', 'switch_8_port_poe', 'tower_pc',
    ]);
    const sw = rows.find((r) => r.key === 'switch_8_port')!;
    expect(sw.port_layout).toHaveLength(8);
    expect(sw.port_layout[7].uplink).toBe(true);
    const poe = rows.find((r) => r.key === 'switch_8_port_poe')!;
    expect(poe.port_layout.every((x) => x.poe)).toBe(true);
    const sw24 = rows.find((r) => r.key === 'switch_24_port')!;
    expect(sw24.port_layout.filter((x) => x.kind === 'rj45')).toHaveLength(24);
    expect(sw24.port_layout.filter((x) => x.kind === 'sfp')).toHaveLength(2);
  });

  it('port layouts stay inside the normalised grid', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const port of t.port_layout) {
        expect(port.x).toBeGreaterThanOrEqual(0);
        expect(port.x).toBeLessThanOrEqual(1000);
        expect(port.y).toBeGreaterThanOrEqual(0);
        expect(port.y).toBeLessThanOrEqual(t.height_u * 100);
      }
    }
  });
});
