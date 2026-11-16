import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { defaultDataDir } from '../config';

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: DB;
  close: () => Promise<void>;
  kind: 'postgres' | 'pglite';
}

/** Linux containers: a mounted volume has a different device id from the root filesystem. */
function warnIfNotPersistent(dataDir: string) {
  try {
    if (process.platform === 'linux' && fs.statSync(dataDir).dev === fs.statSync('/').dev) {
      console.warn(`WARNING: ${dataDir} is not a mounted volume. Data will be lost when the container is replaced. `
        + `In CapRover add a Persistent Directory with path ${dataDir}.`);
    }
  } catch { /* directory does not exist yet: it is created on first write */ }
}

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(here, '../drizzle'), // bundled: apps/api/dist -> apps/api/drizzle
    path.resolve(here, '../../drizzle'), // source: apps/api/src/db -> apps/api/drizzle
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

/**
 * Open the database. Production uses PostgreSQL via DATABASE_URL.
 * Without DATABASE_URL (local dev and tests) it falls back to PGlite, either in memory
 * or persisted in PGLITE_DIR. See DECISIONS.md.
 */
export async function openDb(opts: { url?: string; pgliteDir?: string; memory?: boolean } = {}): Promise<DbHandle> {
  const url = opts.memory ? undefined : (opts.url ?? process.env.DATABASE_URL);
  if (url) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return { db: db as unknown as DB, close: () => pool.end(), kind: 'postgres' };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  let dir = opts.memory ? undefined : (opts.pgliteDir ?? (process.env.PGLITE_DIR || undefined));
  if (!dir && !opts.memory && process.env.NODE_ENV === 'production') {
    // Zero-config production: never an in-memory database; use the persistent data directory.
    dir = path.join(defaultDataDir(), 'pglite');
    warnIfNotPersistent(defaultDataDir());
    console.log(`No DATABASE_URL set: using the embedded database in ${dir}`);
  }
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { db: db as unknown as DB, close: () => client.close(), kind: 'pglite' };
}
