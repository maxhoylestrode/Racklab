import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authedEnv, api, type TestEnv } from './helpers';

let env: TestEnv;
let a: ReturnType<typeof api>;
const tpl: Record<string, string> = {};
const MASTER = 'inventory master password 1';
const SECRET = 'S3cret-value-that-must-never-leak';
const TOTP = 'JBSWY3DPEHPK3PXP';
const NOTE = 'private note text, encrypted';

beforeAll(async () => {
  env = await authedEnv();
  a = api(env);
  for (const t of (await a.get('/api/templates')).body as { id: string; key: string }[]) tpl[t.key] = t.id;
});
afterAll(async () => env.handle.close());

const rack = async () => (await a.post('/api/racks', { name: `Inv ${Math.random()}`, total_units: 12 })).body.id as string;
const device = async (name: string, key: string, place: Record<string, unknown> = {}) => (await a.post('/api/devices', { name, template_id: tpl[key], ...place })).body;

describe('GET /api/inventory', () => {
  it('returns one row per device with primary IP, conflicts, open projects and a credential count', async () => {
    const rid = await rack();
    const sw = await device('Inv switch', 'switch_8_port', { rack_id: rid, rack_unit_start: 3 });
    const loose = await device('Inv laptop', 'laptop', { status: 'planned' });
    await a.post('/api/ip-addresses', { device_id: sw.id, address: '10.9.0.2', is_primary: true });
    await a.post('/api/ip-addresses', { device_id: loose.id, address: '10.9.0.2' }); // duplicate of the switch
    await a.post('/api/projects', { title: 'Inv project', links: [{ device_id: sw.id }] });

    const rows = (await a.get('/api/inventory')).body as any[];
    const devs = (await a.get('/api/devices')).body as any[];
    expect(rows.map((r) => r.device_id).sort()).toEqual(devs.map((d) => d.id).sort());
    const s = rows.find((r) => r.device_id === sw.id);
    expect(s.primary_ip).toMatchObject({ address: '10.9.0.2', is_primary: true });
    expect(s.ip_conflict).toBe(true);
    expect(s.primary_ip.warnings[0].code).toBe('duplicate_ip');
    expect(s.open_projects).toBe(1);
    const l = rows.find((r) => r.device_id === loose.id);
    expect(l.ip_conflict).toBe(true);
    expect(l.open_projects).toBe(0);
  });

  it('never includes a secret field or value, only a credential count', async () => {
    const d = await device('Inv server', 'dell_r420');
    const svc = (await a.post('/api/services', { device_id: d.id, name: 'Inv svc', kind: 'lxc', status: 'running' })).body;
    expect((await a.post('/api/vault/setup', { master_password: MASTER })).status).toBe(201);
    expect((await a.post('/api/credentials', { device_id: d.id, label: 'iDRAC', username_plain: 'root', secret: SECRET, totp_seed: TOTP, private_notes: NOTE })).status).toBe(201);
    expect((await a.post('/api/credentials', { service_id: svc.id, label: 'svc login', secret: SECRET })).status).toBe(201);

    const res = await a.get('/api/inventory');
    const row = (res.body as any[]).find((r) => r.device_id === d.id);
    expect(row.credential_count).toBe(2);
    const text = JSON.stringify(res.body);
    for (const leak of [SECRET, TOTP, NOTE, 'iDRAC', 'root', 'ciphertext', 'secret', 'totp', 'username', 'private_notes', 'nonce']) {
      expect(text).not.toContain(leak);
    }
    for (const r of res.body as Record<string, unknown>[]) {
      expect(Object.keys(r).sort()).toEqual(['credential_count', 'device_id', 'ip_conflict', 'ip_count', 'open_projects', 'primary_ip']);
    }
  });
});

describe('inventory edits go through the existing API', () => {
  it('inline edit: a valid patch saves, an invalid one is rejected and changes nothing', async () => {
    const d = await device('Inline', 'switch_8_port');
    expect((await a.patch(`/api/devices/${d.id}`, { role: 'Edge switch', hostname: 'edge-sw' })).body).toMatchObject({ role: 'Edge switch', hostname: 'edge-sw' });
    const bad = await a.patch(`/api/devices/${d.id}`, { name: '' });
    expect(bad.status).toBe(400);
    expect((await a.get(`/api/devices/${d.id}`)).body.name).toBe('Inline');
  });

  it('rack position from the table uses the same collision rules and error codes as the rack view', async () => {
    const rid = await rack();
    await device('Holder', 'switch_8_port', { rack_id: rid, rack_unit_start: 5 });
    const mover = await device('Mover', 'switch_8_port');
    const clash = await a.post(`/api/devices/${mover.id}/move`, { rack_id: rid, rack_unit_start: 5, shelf_device_id: null, shelf_slot: null });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('collision');
    const ok = await a.post(`/api/devices/${mover.id}/move`, { rack_id: rid, rack_unit_start: 6, shelf_device_id: null, shelf_slot: null });
    expect(ok.status).toBe(200);
    expect(ok.body.rack_unit_start).toBe(6);
  });

  it('bulk status change: every selected device updates through PATCH /devices/:id', async () => {
    const ids = [(await device('Bulk 1', 'switch_8_port')).id, (await device('Bulk 2', 'laptop')).id, (await device('Bulk 3', 'raspberry_pi_4')).id];
    const results = await Promise.all(ids.map((id) => a.patch(`/api/devices/${id}`, { status: 'offline' })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const devs = (await a.get('/api/devices')).body as any[];
    for (const id of ids) expect(devs.find((x) => x.id === id).status).toBe('offline');
    expect((await a.patch(`/api/devices/${ids[0]}`, { status: 'exploded' })).status).toBe(400);
  });

  it('primary IP edit updates the existing primary row and reports duplicate warnings', async () => {
    const x = await device('IP owner', 'switch_8_port');
    const y = await device('IP other', 'switch_8_port');
    await a.post('/api/ip-addresses', { device_id: y.id, address: '10.77.0.5' });
    const ip = (await a.post('/api/ip-addresses', { device_id: x.id, address: '10.77.0.4', is_primary: true })).body;
    const upd = await a.patch(`/api/ip-addresses/${ip.id}`, { address: '10.77.0.5' });
    expect(upd.status).toBe(200);
    expect(upd.body.warnings.map((w: { code: string }) => w.code)).toContain('duplicate_ip');
    expect((await a.patch(`/api/ip-addresses/${ip.id}`, { address: 'not-an-ip' })).status).toBe(400);
  });
});
