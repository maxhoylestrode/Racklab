import { and, eq, inArray, count } from 'drizzle-orm';
import type { DB } from './client';
import { auditLog, racks, devices, deviceTemplates, ports, links, services, notes, projects, projectLinks } from './schema';
import { audit } from '../services/audit';

/**
 * Seed lab (spec section 12). Every seeded row is recorded in the audit log as a `seed.entity`
 * entry so "delete seed data" can remove exactly what was seeded.
 */
export async function hasSeedBeenLoaded(db: DB): Promise<boolean> {
  const [{ n }] = await db.select({ n: count() }).from(auditLog).where(eq(auditLog.action, 'seed.loaded'));
  return n > 0;
}

export async function seedOnFirstRun(db: DB): Promise<boolean> {
  if (await hasSeedBeenLoaded(db)) return false;
  const [{ n }] = await db.select({ n: count() }).from(racks);
  if (n > 0) return false;
  await loadSeed(db);
  return true;
}

export async function loadSeed(db: DB): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const tpls = await t.select().from(deviceTemplates).where(eq(deviceTemplates.is_builtin, true));
    const tpl = (key: string) => {
      const x = tpls.find((y) => y.key === key);
      if (!x) throw new Error(`Missing built-in template ${key}`);
      return x;
    };
    const mark = (type: string, id: string, name: string) => audit(t, 'seed.entity', type, id, name);

    const [rack] = await t.insert(racks).values({ name: 'Home Rack', total_units: 12 }).returning();
    await mark('rack', rack.id, rack.name);

    const make = async (
      name: string, key: string,
      place: { u?: number; shelf?: string; slot?: number },
      extra: Partial<typeof devices.$inferInsert> = {},
    ) => {
      const tp = tpl(key);
      const [d] = await t.insert(devices).values({
        name,
        template_id: tp.id,
        rack_id: place.u ? rack.id : null,
        rack_unit_start: place.u ?? null,
        shelf_device_id: place.shelf ?? null,
        shelf_slot: place.slot ?? null,
        status: 'online',
        ...extra,
      }).returning();
      const ps = tp.port_layout.length
        ? await t.insert(ports).values(tp.port_layout.map((p, i) => ({
          device_id: d.id, label: p.label, kind: p.kind, speed_mbps: p.speed_mbps, poe: p.poe,
          position_index: i, layout_x: p.x, layout_y: p.y, group: p.group ?? null,
        }))).returning()
        : [];
      await mark('device', d.id, d.name);
      return { ...d, port: (label: string) => {
        const p = ps.find((x) => x.label === label);
        if (!p) throw new Error(`${name} has no port ${label}`);
        return p.id;
      } };
    };

    const shelf1 = await make('Shelf 1', 'shelf_1u', { u: 12 });
    const shelf2 = await make('Shelf 2', 'shelf_1u', { u: 8 });
    const shelf3 = await make('Shelf 3', 'shelf_2u', { u: 1 });
    const router = await make('Router (TP-Link Archer AX12)', 'generic_router', { shelf: shelf1.id, slot: 1 }, { role: 'Router', hostname: 'router' });
    const sw1 = await make('Switch 1', 'switch_8_port', { u: 10 }, { role: 'Core switch' });
    const pc = await make('Desktop PC', 'tower_pc', {}, { role: 'Desktop' });
    const laptop = await make('Laptop', 'laptop', {}, { role: 'Laptop', tags: ['wifi'] });
    const pi = await make('Raspberry Pi', 'raspberry_pi_4', { shelf: shelf2.id, slot: 1 }, { role: 'Twingate connector', os: 'Raspberry Pi OS' });
    const sw2 = await make('Switch 2', 'switch_8_port', { u: 6 }, { role: 'Server switch' });
    const r420 = await make('Dell R420 (Proxmox)', 'dell_r420', { u: 4 }, { role: 'Hypervisor', os: 'Proxmox VE', hostname: 'pve' });
    const pcServer = await make('PC-case server', 'tower_pc', { shelf: shelf3.id, slot: 1 }, { role: 'Game and app server', os: 'Linux', location_note: 'i5-9500, runs Pelican and Minecraft' });

    const cable = async (a: string, b: string, label: string) => {
      const [l] = await t.insert(links).values({ port_a_id: a, port_b_id: b, cable_type: 'cat6', cable_color: '#3b82f6', label }).returning();
      await mark('link', l.id, label);
    };
    await cable(router.port('LAN 1'), sw1.port('Port 1'), 'Router to Switch 1');
    await cable(pc.port('eth0'), sw1.port('Port 2'), 'Desktop PC');
    await cable(laptop.port('eth0 (dongle)'), sw1.port('Port 3'), 'Laptop');
    await cable(pi.port('eth0'), sw1.port('Port 4'), 'Raspberry Pi');
    await cable(sw1.port('Port 8'), sw2.port('Port 1'), 'Switch 1 uplink to Switch 2');
    await cable(sw2.port('Port 2'), r420.port('LOM 1'), 'R420 LOM 1');
    await cable(sw2.port('Port 3'), pcServer.port('eth0'), 'PC-case server');

    const [note] = await t.insert(notes).values({
      device_id: r420.id, title: 'Proxmox host', pinned: true,
      body_markdown: '# Proxmox VE host\n\n- Hypervisor: Proxmox VE\n- GPU: GTX 1060 3GB installed\n',
    }).returning();
    await mark('note', note.id, note.title);

    const [tw] = await t.insert(services).values({ device_id: pi.id, name: 'Twingate connector', kind: 'app', status: 'running' }).returning();
    await mark('service', tw.id, tw.name);

    const proj = async (title: string, status: 'not_started' | 'in_progress', order: number, deviceIds: string[]) => {
      const [p] = await t.insert(projects).values({ title, status, sort_order: order, priority: 'medium' }).returning();
      if (deviceIds.length) await t.insert(projectLinks).values(deviceIds.map((d) => ({ project_id: p.id, device_id: d })));
      await mark('project', p.id, p.title);
    };
    await proj('Set up WireGuard in a Proxmox CT', 'not_started', 0, [r420.id]);
    await proj('Cluster the two Proxmox servers', 'not_started', 1, [r420.id, pcServer.id]);
    await proj('Document all containers and IPs', 'in_progress', 0, []);

    await audit(t, 'seed.loaded', 'seed', null, 'Seed lab loaded (Home Rack)');
  });
}

/** Removes every row recorded as seeded that still exists. Returns how many were removed. */
export async function deleteSeed(db: DB): Promise<number> {
  const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'seed.entity'));
  const ids = (type: string) => entries.filter((e) => e.entity_type === type && e.entity_id).map((e) => e.entity_id!);
  let removed = 0;
  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const del = async (table: any, list: string[]) => {
      if (!list.length) return;
      const rows = await t.delete(table).where(inArray(table.id, list)).returning({ id: table.id });
      removed += rows.length;
    };
    await del(projects, ids('project'));
    await del(notes, ids('note'));
    await del(services, ids('service'));
    await del(links, ids('link'));
    // Devices on shelves first, then the shelves, so nothing is orphaned into the tray.
    await del(devices, ids('device'));
    await del(racks, ids('rack'));
    await t.update(auditLog).set({ action: 'seed.entity_removed' }).where(and(eq(auditLog.action, 'seed.entity')));
  });
  await audit(db, 'seed.deleted', 'seed', null, `Removed ${removed} seeded records`);
  return removed;
}
