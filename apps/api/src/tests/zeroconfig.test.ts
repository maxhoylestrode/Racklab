import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { resolveSessionSecret, loadConfig } from '../config';
import { openDb } from '../db/client';
import { ensureBuiltins } from '../db/bootstrap';
import { createContext } from '../context';
import { createApp } from '../app';
import { allRoutes } from '../routes';
import { TestClock } from '../clock';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rackmap-zc-'));

describe('zero-config start', () => {
  it('generates a session secret once and reuses it after a restart', () => {
    delete process.env.SESSION_SECRET;
    const dir = tmp();
    const a = resolveSessionSecret(dir);
    const b = resolveSessionSecret(dir);
    expect(a).toHaveLength(64);
    expect(b).toBe(a);
    expect(fs.readFileSync(path.join(dir, 'session-secret'), 'utf8')).toBe(a);
    process.env.SESSION_SECRET = 'x'.repeat(40);
    expect(resolveSessionSecret(dir)).toBe('x'.repeat(40));
    process.env.SESSION_SECRET = 'short';
    expect(() => resolveSessionSecret(dir)).toThrow(/32 characters/);
  });

  it('defaults backups under the data directory and cookies to auto', () => {
    delete process.env.BACKUP_DIR;
    delete process.env.COOKIE_SECURE;
    const dir = tmp();
    const c = loadConfig({ dataDir: dir, sessionSecret: 'y'.repeat(40) });
    expect(c.backupDir).toBe(path.join(dir, 'backups'));
    expect(c.cookieSecure).toBe('auto');
  });

  it('in production without DATABASE_URL uses an embedded database in the data directory', async () => {
    const dir = tmp();
    process.env.NODE_ENV = 'production';
    process.env.DATA_DIR = dir;
    delete process.env.DATABASE_URL;
    delete process.env.PGLITE_DIR;
    const h = await openDb();
    expect(h.kind).toBe('pglite');
    await h.close();
    expect(fs.existsSync(path.join(dir, 'pglite'))).toBe(true);
  });
});

describe('cookie Secure flag in auto mode', () => {
  it('is set for HTTPS (via a trusted proxy) and not for plain HTTP', async () => {
    const h = await openDb({ memory: true });
    await ensureBuiltins(h.db);
    delete process.env.COOKIE_SECURE;
    const config = loadConfig({ dataDir: tmp(), sessionSecret: 'z'.repeat(40) });
    expect(config.cookieSecure).toBe('auto');
    const app = createApp(createContext(h.db, config, new TestClock()), allRoutes);
    const http = await request(app).post('/api/auth/setup').send({ password: 'correct horse battery' });
    expect(http.status).toBe(201);
    expect(([] as string[]).concat(http.headers['set-cookie'] ?? []).join(';')).not.toMatch(/Secure/i);
    const https = await request(app).post('/api/auth/login').set('X-Forwarded-Proto', 'https').send({ password: 'correct horse battery' });
    expect(https.status).toBe(200);
    const cookies = ([] as string[]).concat(https.headers['set-cookie'] ?? []);
    expect(cookies.every((c) => /;\s*Secure/i.test(c))).toBe(true);
    await h.close();
  });
});
