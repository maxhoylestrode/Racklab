import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { authedEnv, api, type TestEnv } from './helpers';
import { loadSeed } from '../db/seed';

let env: TestEnv;
let a: ReturnType<typeof api>;
const tpl: Record<string, string> = {};

beforeAll(async () => {
  env = await authedEnv();
  a = api(env);
  const ts = (await a.get('/api/templates')).body as { id: string; key: string }[];
  for (const t of ts) tpl[t.key] = t.id;
});
afterAll(async () => env.handle.close());

async function rack(units = 12) {
  const r = await a.post('/api/racks', { name: `Rack ${Math.random()}`, total_units: units });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function device(name: string, key: string, place: Record<string, unknown> = {}) {
  const r = await a.post('/api/devices', { name, template_id: tpl[key], ...place });
  return r;
}

describe('rack placement rules', () => {
  it('creates a device with ports copied from its template', async () => {
    const rid = await rack();
    const r = await device('Core', 'switch_8_port', { rack_id: rid, rack_unit_start: 5 });
    expect(r.status).toBe(201);
    expect(r.body.ports).toHaveLength(8);
    expect(r.body.ports[0]).toMatchObject({ label: 'Port 1', kind: 'rj45', layout_x: 430 });
  });

  it('rejects two devices overlapping in the same rack units', async () => {
    const rid = await rack();
    expect((await device('R720', 'dell_r720', { rack_id: rid, rack_unit_start: 3 })).status).toBe(201); // U3-U4
    const clash = await device('Switch', 'switch_8_port', { rack_id: rid, rack_unit_start: 4 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('collision');
    expect((await device('Switch', 'switch_8_port', { rack_id: rid, rack_unit_start: 5 })).status).toBe(201);
  });

  it('rejects a device extending past the rack', async () => {
    const rid = await rack(4);
    const r = await device('Tall', 'dell_r720', { rack_id: rid, rack_unit_start: 4 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('out_of_rack');
    expect((await device('Low', 'switch_8_port', { rack_id: rid, rack_unit_start: 0 })).status).toBe(400);
  });

  it('enforces collisions on move, too', async () => {
    const rid = await rack();
    const x = (await device('A', 'switch_8_port', { rack_id: rid, rack_unit_start: 1 })).body;
    const y = (await device('B', 'switch_8_port', { rack_id: rid, rack_unit_start: 2 })).body;
    expect((await a.post(`/api/devices/${y.id}/move`, { rack_id: rid, rack_unit_start: 1 })).status).toBe(409);
    expect((await a.post(`/api/devices/${y.id}/move`, { rack_id: rid, rack_unit_start: 3 })).status).toBe(200);
    expect((await a.post(`/api/devices/${x.id}/move`, { rack_id: rid, rack_unit_start: 1 })).status).toBe(200); // itself is fine
    expect((await a.post(`/api/devices/${x.id}/move`, { rack_id: rid, rack_unit_start: 12 })).status).toBe(200);
    expect((await a.post(`/api/devices/${x.id}/move`, { rack_id: rid, rack_unit_start: 13 })).status).toBe(409);
  });

  it('a shelf slot holds one device, and loose devices only go on shelves or the tray', async () => {
    const rid = await rack();
    const shelf = (await device('Shelf', 'shelf_1u', { rack_id: rid, rack_unit_start: 6 })).body;
    expect((await device('Pi in rack', 'raspberry_pi_4', { rack_id: rid, rack_unit_start: 7 })).body.error.code).toBe('loose_needs_shelf');
    expect((await device('Pi', 'raspberry_pi_4', { shelf_device_id: shelf.id, shelf_slot: 1 })).status).toBe(201);
    const taken = await device('Pi 2', 'raspberry_pi_4', { shelf_device_id: shelf.id, shelf_slot: 1 });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('slot_taken');
    expect((await device('Pi 2', 'raspberry_pi_4', { shelf_device_id: shelf.id, shelf_slot: 3 })).body.error.code).toBe('bad_slot');
    expect((await device('Tower', 'tower_pc', { shelf_device_id: shelf.id, shelf_slot: 2 })).body.error.code).toBe('too_tall');
    const sw = (await device('Not a shelf', 'switch_8_port', { rack_id: rid, rack_unit_start: 1 })).body;
    expect((await device('Pi 3', 'raspberry_pi_4', { shelf_device_id: sw.id, shelf_slot: 1 })).body.error.code).toBe('not_a_shelf');
    // Unracked tray: no placement at all.
    expect((await device('Loose laptop', 'laptop')).status).toBe(201);
  });
});

describe('templates', () => {
  it('built-ins are read-only; clones are editable; deleting a template in use is rejected', async () => {
    expect((await a.patch(`/api/templates/${tpl.switch_8_port}`, { name: 'x' })).status).toBe(403);
    expect((await a.del(`/api/templates/${tpl.switch_8_port}`)).status).toBe(403);
    const clone = (await a.post(`/api/templates/${tpl.switch_8_port}/clone`, { name: 'My switch' })).body;
    expect(clone.is_builtin).toBe(false);
    expect(clone.port_layout).toHaveLength(8);
    expect((await a.patch(`/api/templates/${clone.id}`, { name: 'My 8 port' })).status).toBe(200);
    const d = (await a.post('/api/devices', { name: 'Uses clone', template_id: clone.id })).body;
    const del = await a.del(`/api/templates/${clone.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('template_in_use');
    await a.del(`/api/devices/${d.id}`);
    expect((await a.del(`/api/templates/${clone.id}`)).status).toBe(200);
  });

  it('custom templates validate port positions against height', async () => {
    const bad = await a.post('/api/templates', {
      name: 'Bad', category: 'other', form_factor: 'rack', height_u: 1,
      port_layout: [{ label: 'p', kind: 'rj45', speed_mbps: 1000, poe: false, x: 10, y: 150 }],
    });
    expect(bad.status).toBe(400);
  });
});

describe('links', () => {
  let s1: any, s2: any, fast: any;
  beforeAll(async () => {
    s1 = (await device('L1', 'switch_8_port')).body;
    s2 = (await device('L2', 'switch_8_port')).body;
    fast = (await device('L3', 'switch_24_port')).body;
  });

  it('a link cannot join a device to itself or a port to itself', async () => {
    const self = await a.post('/api/links', { port_a_id: s1.ports[0].id, port_b_id: s1.ports[0].id });
    expect(self.body.error.code).toBe('self_link');
    const same = await a.post('/api/links', { port_a_id: s1.ports[0].id, port_b_id: s1.ports[1].id });
    expect(same.body.error.code).toBe('same_device');
  });

  it('a port is in at most one link', async () => {
    const ok = await a.post('/api/links', { port_a_id: s1.ports[0].id, port_b_id: s2.ports[0].id });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ cable_type: 'cat6', cable_color: '#3b82f6', warnings: [] });
    const again = await a.post('/api/links', { port_a_id: s2.ports[0].id, port_b_id: fast.ports[0].id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('port_in_use');
  });

  it('a speed mismatch is a warning, not an error', async () => {
    await a.patch(`/api/ports/${fast.ports[5].id}`, { speed_mbps: 100 });
    const r = await a.post('/api/links', { port_a_id: s1.ports[3].id, port_b_id: fast.ports[5].id });
    expect(r.status).toBe(201);
    expect(r.body.warnings[0].code).toBe('speed_mismatch');
  });

  it('deleting a device cascades to its ports and links', async () => {
    const before = (await a.get('/api/links')).body.length;
    await a.del(`/api/devices/${s2.id}`);
    expect((await a.get('/api/links')).body.length).toBe(before - 1);
    expect((await a.get(`/api/devices/${s2.id}`)).status).toBe(404);
  });
});

describe('IPs, VLANs, services, notes', () => {
  it('flags duplicate IPs and IPs outside their VLAN subnet', async () => {
    const d1 = (await device('IP host 1', 'tower_pc')).body;
    const d2 = (await device('IP host 2', 'tower_pc')).body;
    const vlan = (await a.post('/api/vlans', { vlan_number: 20, name: 'Servers', subnet: '10.0.20.0/24' })).body;
    expect((await a.post('/api/ip-addresses', { device_id: d1.id, address: 'not-an-ip' })).status).toBe(400);
    const ip1 = await a.post('/api/ip-addresses', { device_id: d1.id, address: '10.0.20.5', vlan_id: vlan.id, is_primary: true });
    expect(ip1.status).toBe(201);
    expect(ip1.body.warnings).toEqual([]);
    const ip2 = await a.post('/api/ip-addresses', { device_id: d2.id, address: '10.0.20.5' });
    expect(ip2.body.warnings.map((w: any) => w.code)).toContain('duplicate_ip');
    const ip3 = await a.post('/api/ip-addresses', { device_id: d2.id, address: '192.168.1.9', vlan_id: vlan.id });
    expect(ip3.body.warnings.map((w: any) => w.code)).toContain('outside_vlan_subnet');
    // Only one primary per device.
    await a.post('/api/ip-addresses', { device_id: d1.id, address: '10.0.20.6', is_primary: true });
    const list = (await a.get(`/api/ip-addresses?device_id=${d1.id}`)).body;
    expect(list.filter((x: any) => x.is_primary)).toHaveLength(1);
  });

  it('returns services as a tree and rejects cycles', async () => {
    const host = (await device('PVE', 'dell_r420')).body;
    const vm = (await a.post('/api/services', { device_id: host.id, name: 'VM 200', kind: 'vm', vmid_or_ctid: 200 })).body;
    const docker = (await a.post('/api/services', { device_id: host.id, parent_service_id: vm.id, name: 'Portainer', kind: 'docker' })).body;
    await a.post('/api/services', { device_id: host.id, name: 'CT 100', kind: 'lxc', vmid_or_ctid: 100 });
    const tree = (await a.get(`/api/devices/${host.id}/services`)).body;
    expect(tree.map((n: any) => n.name)).toEqual(['CT 100', 'VM 200']);
    expect(tree[1].children[0].name).toBe('Portainer');
    expect((await a.patch(`/api/services/${vm.id}`, { parent_service_id: docker.id })).body.error.code).toBe('service_cycle');
  });

  it('searches notes by full text', async () => {
    await a.post('/api/notes', { title: 'ISP details', body_markdown: 'Fibre 900/100, static IP from the ISP' });
    await a.post('/api/notes', { title: 'Port forwards', body_markdown: '25565 to minecraft' });
    const hits = (await a.get('/api/notes?q=minecraft')).body;
    expect(hits.map((n: any) => n.title)).toEqual(['Port forwards']);
    expect((await a.get('/api/notes?scope=global')).body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('credentials', () => {
  it('never returns secrets except via reveal, and needs the vault unlocked', async () => {
    const dev = (await device('Cred host', 'dell_r420')).body;
    const locked = await a.post('/api/credentials', { device_id: dev.id, label: 'root', secret: 'pw' });
    expect(locked.status).toBe(423);
    expect((await a.post('/api/vault/setup', { master_password: 'my vault master password' })).status).toBe(201);
    const created = await a.post('/api/credentials', {
      device_id: dev.id, label: 'iDRAC', username_plain: 'root', secret: 'calvin-super-secret', totp_seed: 'JBSWY3DPEHPK3PXP', private_notes: 'reset via front panel',
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('calvin-super-secret');
    expect(created.body).toMatchObject({ has_totp: true, has_notes: true, username_plain: 'root' });
    const list = (await a.get(`/api/credentials?device_id=${dev.id}`)).body;
    expect(JSON.stringify(list)).not.toMatch(/calvin|ciphertext|nonce|JBSWY/);

    const rev = await a.post(`/api/credentials/${created.body.id}/reveal`);
    expect(rev.body).toMatchObject({ secret: 'calvin-super-secret', totp_seed: 'JBSWY3DPEHPK3PXP', private_notes: 'reset via front panel' });

    // Plaintext appears nowhere in the database or the audit log.
    const dump: any = await env.handle.db.execute(sql`select * from credentials`);
    const all = JSON.stringify(dump.rows ?? dump, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v));
    expect(all).not.toContain('calvin');
    const auditRows: any = await env.handle.db.execute(sql`select * from audit_log`);
    expect(JSON.stringify(auditRows.rows ?? auditRows)).not.toContain('calvin');

    await a.post('/api/vault/lock');
    expect((await a.post(`/api/credentials/${created.body.id}/reveal`)).status).toBe(423);
  });
});

describe('projects', () => {
  it('validates titles and link targets', async () => {
    expect((await a.post('/api/projects', { title: '' })).status).toBe(400);
    expect((await a.post('/api/projects', { title: 'x'.repeat(201) })).status).toBe(400);
    const missing = await a.post('/api/projects', { title: 'Ghost', links: [{ device_id: '00000000-0000-4000-8000-000000000000' }] });
    expect(missing.body.error.code).toBe('link_target_missing');
  });

  it('creates linked and unlinked projects; a deleted device leaves the project intact', async () => {
    const dev = (await device('Project host', 'dell_r420')).body;
    const linked = (await a.post('/api/projects', { title: 'Add a second NIC', links: [{ device_id: dev.id }] })).body;
    const unlinked = (await a.post('/api/projects', { title: 'Tidy cables' })).body;
    expect(linked.links).toHaveLength(1);
    expect(linked.links[0].device_name).toBe('Project host');
    expect(unlinked.links).toHaveLength(0);
    expect((await a.get(`/api/projects?device_id=${dev.id}`)).body.map((p: any) => p.id)).toEqual([linked.id]);
    const badges = (await a.get('/api/projects/badges')).body;
    expect(badges.find((b: any) => b.device_id === dev.id).open_count).toBe(1);

    await a.del(`/api/devices/${dev.id}`);
    const after = (await a.get(`/api/projects/${linked.id}`)).body;
    expect(after.title).toBe('Add a second NIC');
    expect(after.links).toHaveLength(0);
  });

  it('moving renumbers the column and manages completed_at', async () => {
    const ids: string[] = [];
    for (const t of ['P1', 'P2', 'P3']) ids.push((await a.post('/api/projects', { title: t, status: 'in_progress' })).body.id);
    const moved = (await a.post(`/api/projects/${ids[2]}/move`, { status: 'in_progress', sort_order: 0 })).body;
    expect(moved.sort_order).toBe(0);
    const col = (await a.get('/api/projects')).body.filter((p: any) => p.status === 'in_progress').sort((x: any, y: any) => x.sort_order - y.sort_order);
    expect(col.map((p: any) => p.sort_order)).toEqual(col.map((_: any, i: number) => i));
    expect(col[0].id).toBe(ids[2]);

    const done = (await a.post(`/api/projects/${ids[0]}/move`, { status: 'complete', sort_order: 0 })).body;
    expect(done.completed_at).not.toBeNull();
    const back = (await a.patch(`/api/projects/${ids[0]}`, { status: 'not_started' })).body;
    expect(back.completed_at).toBeNull();
  });

  it('supports checklists and archiving', async () => {
    const p = (await a.post('/api/projects', { title: 'Jellyfin CT' })).body;
    const t1 = (await a.post(`/api/projects/${p.id}/tasks`, { text: 'Create CT' })).body;
    await a.post(`/api/projects/${p.id}/tasks`, { text: 'Mount media' });
    await a.patch(`/api/projects/${p.id}/tasks/${t1.id}`, { done: true });
    expect((await a.get(`/api/projects/${p.id}`)).body.task_progress).toEqual({ done: 1, total: 2 });
    await a.patch(`/api/projects/${p.id}`, { archived: true });
    expect((await a.get('/api/projects')).body.find((x: any) => x.id === p.id)).toBeUndefined();
    expect((await a.get('/api/projects?include_archived=true')).body.find((x: any) => x.id === p.id)).toBeDefined();
  });
});

describe('seed, export and import', () => {
  it('seeds the Home Rack lab with the right wiring and can delete it', async () => {
    const e = await authedEnv();
    const x = api(e);
    await loadSeed(e.handle.db);
    const racks = (await x.get('/api/racks')).body;
    expect(racks).toMatchObject([{ name: 'Home Rack', total_units: 12 }]);
    const devs = (await x.get('/api/devices')).body as any[];
    expect(devs).toHaveLength(11);
    const byName = (n: string) => devs.find((d) => d.name.startsWith(n));
    expect(byName('Switch 1').rack_unit_start).toBe(10);
    expect(byName('Dell R420').rack_unit_start).toBe(4);
    expect(byName('Router').shelf_device_id).toBe(byName('Shelf 1').id);
    expect(byName('Desktop PC').rack_id).toBeNull();
    expect((await x.get('/api/links')).body).toHaveLength(7);
    expect((await x.get('/api/ip-addresses')).body).toHaveLength(0);
    expect((await x.get('/api/projects')).body).toHaveLength(3);
    expect((await x.get(`/api/devices/${byName('Raspberry Pi').id}/services`)).body[0]).toMatchObject({ name: 'Twingate connector', kind: 'app' });
    expect((await x.get('/api/credentials')).body).toHaveLength(0);

    const del = await x.post('/api/seed/delete');
    expect(del.body.removed).toBeGreaterThan(10);
    expect((await x.get('/api/devices')).body).toHaveLength(0);
    expect((await x.get('/api/projects')).body).toHaveLength(0);
    await e.handle.close();
  });

  it('exports with secrets encrypted and imports back exactly', async () => {
    const e = await authedEnv();
    const x = api(e);
    await loadSeed(e.handle.db);
    await x.post('/api/vault/setup', { master_password: 'export vault master pw' });
    const pi = (await x.get('/api/devices')).body.find((d: any) => d.name === 'Raspberry Pi');
    await x.post('/api/credentials', { device_id: pi.id, label: 'pi', secret: 'raspberry-plaintext-xyz' });
    await x.post('/api/ip-addresses', { device_id: pi.id, address: '192.168.0.50', is_primary: true });

    const exp = await x.get('/api/export');
    expect(exp.status).toBe(200);
    const text = JSON.stringify(exp.body);
    expect(text).not.toContain('raspberry-plaintext-xyz');
    expect(exp.body.data.credentials).toHaveLength(1);

    // Mess things up, then restore.
    await x.del(`/api/devices/${pi.id}`);
    const bad = await x.post('/api/import', { ...exp.body, data: { ...exp.body.data, links: [...exp.body.data.links, exp.body.data.links[0]] } });
    expect(bad.status).toBe(400); // whole file validated first; nothing applied
    expect((await x.get('/api/devices')).body).toHaveLength(10);

    const ok = await x.post('/api/import', exp.body);
    expect(ok.status).toBe(200);
    expect((await x.get('/api/devices')).body).toHaveLength(11);
    expect((await x.get('/api/links')).body).toHaveLength(7);
    expect((await x.get('/api/ip-addresses')).body[0].address).toBe('192.168.0.50');
    // Vault was locked by import; unlocking with the exported vault's password reveals the secret.
    await x.post('/api/vault/unlock', { master_password: 'export vault master pw' });
    const cred = (await x.get('/api/credentials')).body[0];
    expect((await x.post(`/api/credentials/${cred.id}/reveal`)).body.secret).toBe('raspberry-plaintext-xyz');
    await e.handle.close();
  });
});
