import request from 'supertest';
import { openDb, type DbHandle } from '../db/client';
import { ensureBuiltins } from '../db/bootstrap';
import { loadConfig } from '../config';
import { TestClock } from '../clock';
import { createContext, type AppContext } from '../context';
import { createApp } from '../app';
import { allRoutes } from '../routes';

export const APP_PASSWORD = 'correct horse battery';

export interface TestEnv {
  handle: DbHandle;
  ctx: AppContext;
  clock: TestClock;
  app: ReturnType<typeof createApp>;
  /** A cookie-keeping agent, signed in by authedEnv(). */
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  /** Simulate a process restart: fresh in-memory state, same database. */
  rebuild: () => void;
}

export async function makeEnv(): Promise<TestEnv> {
  const handle = await openDb({ memory: true });
  await ensureBuiltins(handle.db);
  const clock = new TestClock(Date.UTC(2026, 0, 1));
  const config = loadConfig({ cookieSecure: false, sessionSecret: 'test-secret-test-secret-test-secret-00' });
  const ctx = createContext(handle.db, config, clock);
  const env: TestEnv = {
    handle,
    ctx,
    clock,
    app: createApp(ctx, allRoutes),
    agent: null as any,
    csrf: '',
    rebuild() {
      env.ctx = createContext(handle.db, config, clock);
      env.app = createApp(env.ctx, allRoutes);
      env.agent = request.agent(env.app);
    },
  };
  env.agent = request.agent(env.app);
  return env;
}

/** Fresh env with the app password set up and the agent signed in. */
export async function authedEnv(): Promise<TestEnv> {
  const env = await makeEnv();
  const res = await env.agent.post('/api/auth/setup').send({ password: APP_PASSWORD });
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  env.csrf = res.body.csrf_token;
  return env;
}

/** Shorthand for calls with the CSRF header. */
export function api(env: TestEnv) {
  const h = { 'x-csrf-token': env.csrf };
  return {
    get: (url: string) => env.agent.get(url),
    post: (url: string, body?: unknown) => env.agent.post(url).set(h).send(body as any),
    patch: (url: string, body?: unknown) => env.agent.patch(url).set(h).send(body as any),
    put: (url: string, body?: unknown) => env.agent.put(url).set(h).send(body as any),
    del: (url: string) => env.agent.delete(url).set(h),
  };
}
