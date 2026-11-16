import crypto from 'node:crypto';

export interface Config {
  port: number;
  sessionSecret: string;
  cookieSecure: boolean;
  backupDir: string;
  backupRetentionDays: number;
  webDist?: string;
  /** Session sliding expiry and absolute cap (spec 5). */
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const prod = process.env.NODE_ENV === 'production';
  let sessionSecret = process.env.SESSION_SECRET ?? '';
  if (!sessionSecret) {
    if (prod) throw new Error('SESSION_SECRET must be set in production');
    sessionSecret = crypto.randomBytes(32).toString('hex');
  }
  if (prod && sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return {
    port: Number(process.env.PORT ?? 3000),
    sessionSecret,
    cookieSecure: (process.env.COOKIE_SECURE ?? (prod ? 'true' : 'false')) === 'true',
    backupDir: process.env.BACKUP_DIR ?? './data/backups',
    backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 14),
    sessionIdleMs: 12 * 60 * 60 * 1000,
    sessionAbsoluteMs: 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}
