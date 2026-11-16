import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  /** Root for persistent files (session secret, embedded database, backups). */
  dataDir: string;
  sessionSecret: string;
  /** true/false forces the Secure cookie flag; 'auto' sets it when the request arrived over HTTPS. */
  cookieSecure: boolean | 'auto';
  backupDir: string;
  backupRetentionDays: number;
  webDist?: string;
  /** Session sliding expiry and absolute cap (spec 5). */
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
}

export function defaultDataDir(): string {
  return process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/data' : './data');
}

/**
 * SESSION_SECRET if set; otherwise a random secret generated once and kept in `<dataDir>/session-secret`
 * (mode 600), so the app needs no configuration and restarts do not sign everyone out.
 */
export function resolveSessionSecret(dataDir: string): string {
  const fromEnv = process.env.SESSION_SECRET ?? '';
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return fromEnv;
  }
  const file = path.join(dataDir, 'session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* not created yet */ }
  fs.mkdirSync(dataDir, { recursive: true });
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function parseCookieSecure(v: string | undefined): boolean | 'auto' {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return 'auto';
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? defaultDataDir();
  return {
    port: Number(process.env.PORT ?? 3000),
    dataDir,
    sessionSecret: overrides.sessionSecret ?? resolveSessionSecret(dataDir),
    cookieSecure: parseCookieSecure(process.env.COOKIE_SECURE),
    backupDir: process.env.BACKUP_DIR ?? path.join(dataDir, 'backups'),
    backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 14),
    sessionIdleMs: 12 * 60 * 60 * 1000,
    sessionAbsoluteMs: 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}
