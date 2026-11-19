import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authedEnv, api, type TestEnv } from './helpers';

let env: TestEnv;
let a: ReturnType<typeof api>;
beforeAll(async () => { env = await authedEnv(); a = api(env); });
afterAll(async () => env.handle.close());

describe('project customisation', () => {
  it('starts with the three built-in statuses and priorities, ordered', async () => {
    const m = (await a.get('/api/project-meta')).body;
    expect(m.statuses.map((s: any) => [s.key, s.kind])).toEqual([['not_started', 'todo'], ['in_progress', 'active'], ['complete', 'done']]);
    expect(m.priorities.map((p: any) => p.key)).toEqual(['high', 'medium', 'low']);
    // Defaults: first column, middle priority.
    const p = (await a.post('/api/projects', { title: 'Defaults' })).body;
    expect([p.status, p.priority]).toEqual(['not_started', 'medium']);
  });

  it('adds, renames, recolours and reorders statuses; done-kind columns complete their projects', async () => {
    const m = (await a.post('/api/project-meta/statuses', { label: 'Blocked', color: '#e5484d', kind: 'active' })).body;
    const blocked = m.statuses.find((s: any) => s.label === 'Blocked');
    expect(blocked.key).toMatch(/^blocked-/);
    const p = (await a.post('/api/projects', { title: 'Waiting on NIC', status: blocked.key })).body;
    expect(p.completed_at).toBeNull();

    await a.patch(`/api/project-meta/statuses/${blocked.key}`, { label: 'Parked', color: '#8b8d98', kind: 'done' });
    expect((await a.get(`/api/projects/${p.id}`)).body.completed_at).not.toBeNull();
    expect((await a.get('/api/projects?open=true')).body.some((x: any) => x.id === p.id)).toBe(false);
    await a.patch(`/api/project-meta/statuses/${blocked.key}`, { kind: 'todo' });
    expect((await a.get(`/api/projects/${p.id}`)).body.completed_at).toBeNull();

    const keys = ['complete', blocked.key, 'not_started', 'in_progress'];
    const re = (await a.put('/api/project-meta/statuses/order', { keys })).body;
    expect(re.statuses.map((s: any) => s.key)).toEqual(keys);
    expect((await a.put('/api/project-meta/statuses/order', { keys: keys.slice(1) })).status).toBe(400);
    await a.put('/api/project-meta/statuses/order', { keys: ['not_started', 'in_progress', 'complete', blocked.key] });
  });

  it('rejects unknown statuses and priorities', async () => {
    expect((await a.post('/api/projects', { title: 'x', status: 'nope' })).body.error.code).toBe('unknown_status');
    expect((await a.post('/api/projects', { title: 'x', priority: 'nope' })).body.error.code).toBe('unknown_priority');
  });

  it('deleting a status in use needs somewhere to move its projects', async () => {
    const m = (await a.post('/api/project-meta/statuses', { label: 'Testing', color: '#3e83f8' })).body;
    const key = m.statuses.find((s: any) => s.label === 'Testing').key;
    const p = (await a.post('/api/projects', { title: 'Test backups', status: key })).body;
    const refused = await a.del(`/api/project-meta/statuses/${key}`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('reassign_required');
    await a.del(`/api/project-meta/statuses/${key}?reassign_to=complete`);
    const moved = (await a.get(`/api/projects/${p.id}`)).body;
    expect(moved.status).toBe('complete');
    expect(moved.completed_at).not.toBeNull();
  });

  it('manages user-defined priorities the same way', async () => {
    const m = (await a.post('/api/project-meta/priorities', { label: 'Urgent', color: '#d6409f' })).body;
    const urgent = m.priorities.find((p: any) => p.label === 'Urgent');
    await a.put('/api/project-meta/priorities/order', { keys: [urgent.key, 'high', 'medium', 'low'] });
    // Four levels: the default rounds toward less urgent, so it stays Medium.
    expect((await a.post('/api/projects', { title: 'Default level' })).body.priority).toBe('medium');
    const p = (await a.post('/api/projects', { title: 'Replace dying disk', priority: urgent.key })).body;
    expect((await a.del(`/api/project-meta/priorities/${urgent.key}`)).status).toBe(400);
    await a.del(`/api/project-meta/priorities/${urgent.key}?reassign_to=high`);
    expect((await a.get(`/api/projects/${p.id}`)).body.priority).toBe('high');
  });

  it('stores project colour, icon and tag colours', async () => {
    const p = (await a.post('/api/projects', { title: 'Pi-hole', color: '#14a3a3', icon: 'shield', tags: ['dns'] })).body;
    expect([p.color, p.icon]).toEqual(['#14a3a3', 'shield']);
    expect((await a.patch(`/api/projects/${p.id}`, { icon: 'not-an-icon' })).status).toBe(400);
    expect((await a.patch(`/api/projects/${p.id}`, { color: null, icon: null })).body.color).toBeNull();
    const m = (await a.put('/api/project-meta/tags/dns', { color: '#f0a020' })).body;
    expect(m.tag_colors).toContainEqual({ name: 'dns', color: '#f0a020' });
    expect((await a.del('/api/project-meta/tags/dns')).body.tag_colors).toHaveLength(0);
  });

  it('round-trips custom statuses through export and import', async () => {
    await a.put('/api/project-meta/tags/net', { color: '#3e83f8' });
    const file = (await a.get('/api/export')).body;
    expect(file.data.project_statuses.length).toBeGreaterThan(3);
    const before = (await a.get('/api/project-meta')).body;
    expect((await a.post('/api/import', file)).status).toBe(200);
    expect((await a.get('/api/project-meta')).body).toEqual(before);
    // An export from before customisation (no status rows) still imports against this install's statuses.
    const legacy = { ...file, data: { ...file.data, project_statuses: [], project_priorities: [], project_tag_colors: [] } };
    expect((await a.post('/api/import', legacy)).status).toBe(200);
  });
});
