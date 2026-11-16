import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeEnv, authedEnv, api, APP_PASSWORD } from './helpers';
import { appUser } from '../db/schema';

const H = 60 * 60 * 1000;

describe('setup', () => {
  it('requires a 12+ character password and then returns 404 forever', async () => {
    const env = await makeEnv();
    expect((await request(env.app).get('/api/auth/status')).body).toEqual({ setup_required: true });
    expect((await request(env.app).post('/api/auth/setup').send({ password: 'short' })).status).toBe(400);
    expect((await request(env.app).post('/api/auth/setup').send({ password: APP_PASSWORD })).status).toBe(201);
    expect((await request(env.app).post('/api/auth/setup').send({ password: 'another long password' })).status).toBe(404);
    expect((await request(env.app).get('/api/auth/status')).body).toEqual({ setup_required: false });
    const rows = await env.handle.db.select().from(appUser);
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
    await env.handle.close();
  });
});

describe('login', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    const env = await authedEnv();
    const bad = await request(env.app).post('/api/auth/login').send({ password: 'wrong password!!' });
    expect(bad.status).toBe(401);
    env.clock.advance(5000);
    const good = await request(env.app).post('/api/auth/login').send({ password: APP_PASSWORD });
    expect(good.status).toBe(200);
    expect(([] as string[]).concat(good.headers['set-cookie'] ?? []).join(';')).toMatch(/rm_session=.*HttpOnly.*SameSite=Strict/i);
    await env.handle.close();
  });

  it('protects routes when not signed in', async () => {
    const env = await authedEnv();
    expect((await request(env.app).get('/api/auth/me')).status).toBe(401);
    expect((await env.agent.get('/api/auth/me')).status).toBe(200);
    await env.handle.close();
  });

  it('applies exponential backoff between failures', async () => {
    const env = await authedEnv();
    const anon = () => request(env.app).post('/api/auth/login');
    expect((await anon().send({ password: 'nope nope nope' })).status).toBe(401);
    // Retrying straight away is refused (1 s backoff), even with the right password.
    expect((await anon().send({ password: APP_PASSWORD })).status).toBe(429);
    env.clock.advance(1100);
    expect((await anon().send({ password: 'nope nope nope' })).status).toBe(401);
    env.clock.advance(1100); // backoff is now 2 s
    expect((await anon().send({ password: APP_PASSWORD })).status).toBe(429);
    env.clock.advance(1000);
    expect((await anon().send({ password: APP_PASSWORD })).status).toBe(200);
    await env.handle.close();
  });

  it('locks out after 5 failures in 15 minutes, survives a restart, then recovers', async () => {
    const env = await authedEnv();
    for (let i = 0; i < 5; i++) {
      const r = await request(env.app).post('/api/auth/login').send({ password: 'definitely wrong' });
      expect(r.status).toBe(401);
      env.clock.advance(20_000);
    }
    let r = await request(env.app).post('/api/auth/login').send({ password: APP_PASSWORD });
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);

    env.rebuild(); // new process, same database
    r = await request(env.app).post('/api/auth/login').send({ password: APP_PASSWORD });
    expect(r.status).toBe(429);

    env.clock.advance(15 * 60 * 1000);
    r = await request(env.app).post('/api/auth/login').send({ password: APP_PASSWORD });
    expect(r.status).toBe(200);
    await env.handle.close();
  });
});

describe('sessions', () => {
  it('expires after 12 hours idle, sliding on activity', async () => {
    const env = await authedEnv();
    env.clock.advance(11 * H);
    expect((await env.agent.get('/api/auth/me')).status).toBe(200);
    env.clock.advance(11 * H); // 22 h since login, but only 11 h idle
    expect((await env.agent.get('/api/auth/me')).status).toBe(200);
    env.clock.advance(12 * H + 1000);
    expect((await env.agent.get('/api/auth/me')).status).toBe(401);
    await env.handle.close();
  });

  it('has an absolute 7 day cap even when active', async () => {
    const env = await authedEnv();
    for (let i = 0; i < 15; i++) {
      env.clock.advance(11 * H); // 165 h after 15 steps
      expect((await env.agent.get('/api/auth/me')).status).toBe(200);
    }
    env.clock.advance(4 * H); // 169 h > 168 h
    expect((await env.agent.get('/api/auth/me')).status).toBe(401);
    await env.handle.close();
  });

  it('logout destroys the session', async () => {
    const env = await authedEnv();
    expect((await api(env).post('/api/auth/logout')).status).toBe(200);
    expect((await env.agent.get('/api/auth/me')).status).toBe(401);
    await env.handle.close();
  });

  it('rejects a forged cookie', async () => {
    const env = await authedEnv();
    const r = await request(env.app).get('/api/auth/me').set('Cookie', 'rm_session=s%3Aforged.signature');
    expect(r.status).toBe(401);
    await env.handle.close();
  });
});

describe('csrf', () => {
  it('requires the double-submit token on state-changing requests', async () => {
    const env = await authedEnv();
    expect((await env.agent.post('/api/auth/logout')).status).toBe(403);
    expect((await env.agent.post('/api/auth/logout').set('x-csrf-token', 'wrong')).status).toBe(403);
    expect((await api(env).post('/api/auth/logout')).status).toBe(200);
    await env.handle.close();
  });
});

describe('security headers', () => {
  it('sets a strict CSP, no framing and no referrer', async () => {
    const env = await makeEnv();
    const r = await request(env.app).get('/healthz');
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    await env.handle.close();
  });
});
