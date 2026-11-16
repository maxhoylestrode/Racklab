import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

describe('healthz', () => {
  it('returns 200 without auth', async () => {
    const res = await request(createApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
