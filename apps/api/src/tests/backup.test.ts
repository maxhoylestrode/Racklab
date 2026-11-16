import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authedEnv, api } from './helpers';
import { loadSeed } from '../db/seed';
import { writeBackup } from '../services/nightly';

describe('nightly backups', () => {
  it('writes an importable backup and keeps only 14 days', async () => {
    const env = await authedEnv();
    await loadSeed(env.handle.db);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rackmap-bk-'));
    // Pretend older backups exist.
    for (const d of ['2026-01-01', '2026-03-10', '2026-03-20']) await fs.writeFile(path.join(dir, `rackmap-${d}.json`), '{}');
    await fs.writeFile(path.join(dir, 'unrelated.txt'), 'keep me');

    const { file, pruned } = await writeBackup(env.handle.db, dir, 14, new Date('2026-03-25T03:00:00Z'));
    expect(path.basename(file)).toBe('rackmap-2026-03-25.json');
    expect(pruned.sort()).toEqual(['rackmap-2026-01-01.json', 'rackmap-2026-03-10.json']);
    const left = (await fs.readdir(dir)).sort();
    expect(left).toEqual(['rackmap-2026-03-20.json', 'rackmap-2026-03-25.json', 'unrelated.txt']);

    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(data.format).toBe('rackmap-export');
    expect(data.data.projects).toHaveLength(3);
    const res = await api(env).post('/api/import', data);
    expect(res.status).toBe(200);
    await fs.rm(dir, { recursive: true, force: true });
    await env.handle.close();
  });
});
