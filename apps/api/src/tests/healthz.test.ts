import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeEnv } from './helpers';

describe('healthz', () => {
  it('returns 200 without auth', async () => {
    const env = await makeEnv();
    const res = await request(env.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    await env.handle.close();
  });
});
