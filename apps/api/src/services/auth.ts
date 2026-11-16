import crypto from 'node:crypto';
import { eq, lt, or } from 'drizzle-orm';
import type { DB } from '../db/client';
import { appUser, loginAttempts, sessions } from '../db/schema';
import { sodium } from '../crypto/sodium';
import type { Clock } from '../clock';
import type { Config } from '../config';

// ---------- password hashing (argon2id via libsodium crypto_pwhash_str) ----------
const PW_OPSLIMIT = 3;
const PW_MEMLIMIT = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const s = await sodium();
  return s.crypto_pwhash_str(password, PW_OPSLIMIT, PW_MEMLIMIT);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const s = await sodium();
  try {
    return s.crypto_pwhash_str_verify(hash, password);
  } catch {
    return false;
  }
}

export async function userExists(db: DB): Promise<boolean> {
  const rows = await db.select({ id: appUser.id }).from(appUser).limit(1);
  return rows.length > 0;
}

// ---------- sessions ----------
export interface SessionRow {
  id: string;
  csrf_token: string;
  expires_at: Date;
  absolute_expires_at: Date;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export class SessionStore {
  constructor(private db: DB, private clock: Clock, private config: Config) {}

  /** Creates a session; returns the raw token (cookie value) and the session row. */
  async create(): Promise<{ token: string; session: SessionRow }> {
    const token = randomToken();
    const now = this.clock.now();
    const row = {
      id: sha256(token),
      csrf_token: randomToken(),
      created_at: new Date(now),
      last_seen_at: new Date(now),
      expires_at: new Date(now + this.config.sessionIdleMs),
      absolute_expires_at: new Date(now + this.config.sessionAbsoluteMs),
    };
    await this.db.insert(sessions).values(row);
    return { token, session: row };
  }

  /** Looks up a session by raw token, enforcing idle and absolute expiry, and slides the idle expiry. */
  async touch(token: string): Promise<SessionRow | null> {
    const id = sha256(token);
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    if (!row) return null;
    const now = this.clock.now();
    if (row.expires_at.getTime() <= now || row.absolute_expires_at.getTime() <= now) {
      await this.db.delete(sessions).where(eq(sessions.id, id));
      return null;
    }
    const expires = new Date(Math.min(now + this.config.sessionIdleMs, row.absolute_expires_at.getTime()));
    // Only write when it moves meaningfully, to avoid a write on every request.
    if (expires.getTime() - row.expires_at.getTime() > 60_000) {
      await this.db.update(sessions).set({ expires_at: expires, last_seen_at: new Date(now) }).where(eq(sessions.id, id));
      row.expires_at = expires;
    }
    return row;
  }

  async destroy(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async destroyAll(): Promise<void> {
    await this.db.delete(sessions);
  }

  async purgeExpired(): Promise<void> {
    const now = new Date(this.clock.now());
    await this.db.delete(sessions).where(or(lt(sessions.expires_at, now), lt(sessions.absolute_expires_at, now)));
  }
}

// ---------- login rate limiting ----------
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface AttemptState { failures: number; windowStart: number; lockedUntil: number }

/**
 * At most 5 failed logins per 15 minutes per IP. Each failure inside the window also imposes an
 * exponential backoff (1s, 2s, 4s, 8s) before the next attempt; the 5th failure locks the IP until
 * the 15 minute window from the first failure has passed. State is cached in memory and persisted
 * in Postgres so a restart does not reset it.
 */
export class LoginLimiter {
  private mem = new Map<string, AttemptState>();
  constructor(private db: DB, private clock: Clock) {}

  private async load(ip: string): Promise<AttemptState> {
    const cached = this.mem.get(ip);
    if (cached) return cached;
    const [row] = await this.db.select().from(loginAttempts).where(eq(loginAttempts.ip, ip)).limit(1);
    const st: AttemptState = row
      ? { failures: row.failures, windowStart: row.window_started_at.getTime(), lockedUntil: row.locked_until?.getTime() ?? 0 }
      : { failures: 0, windowStart: this.clock.now(), lockedUntil: 0 };
    this.mem.set(ip, st);
    return st;
  }

  private async save(ip: string, st: AttemptState) {
    this.mem.set(ip, st);
    const values = {
      ip,
      failures: st.failures,
      window_started_at: new Date(st.windowStart),
      locked_until: st.lockedUntil ? new Date(st.lockedUntil) : null,
    };
    await this.db.insert(loginAttempts).values(values).onConflictDoUpdate({ target: loginAttempts.ip, set: values });
  }

  /** Returns 0 if an attempt is allowed now, otherwise the number of ms to wait. */
  async check(ip: string): Promise<number> {
    const st = await this.load(ip);
    const now = this.clock.now();
    if (now - st.windowStart >= LOGIN_WINDOW_MS && st.lockedUntil <= now && st.failures > 0) {
      st.failures = 0;
      st.windowStart = now;
      st.lockedUntil = 0;
      await this.save(ip, st);
    }
    return Math.max(0, st.lockedUntil - now);
  }

  async fail(ip: string): Promise<void> {
    const st = await this.load(ip);
    const now = this.clock.now();
    if (st.failures === 0) st.windowStart = now;
    st.failures += 1;
    st.lockedUntil = st.failures >= LOGIN_MAX_FAILURES
      ? st.windowStart + LOGIN_WINDOW_MS
      : now + 1000 * 2 ** (st.failures - 1);
    await this.save(ip, st);
  }

  async succeed(ip: string): Promise<void> {
    this.mem.delete(ip);
    await this.db.delete(loginAttempts).where(eq(loginAttempts.ip, ip));
  }

  /** Test helper: drop the in-memory cache to simulate a process restart. */
  forgetMemory() {
    this.mem.clear();
  }
}
