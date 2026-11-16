import fs from 'node:fs/promises';
import path from 'node:path';
import type { DB } from '../db/client';
import { exportAll } from './backup';
import { audit } from './audit';

const NAME = /^rackmap-(\d{4}-\d{2}-\d{2})\.json$/;

/** Writes today's backup (secrets stay encrypted) and deletes backups older than `retentionDays`. */
export async function writeBackup(db: DB, dir: string, retentionDays: number, now = new Date()): Promise<{ file: string; pruned: string[] }> {
  await fs.mkdir(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 10);
  const file = path.join(dir, `rackmap-${stamp}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(await exportAll(db)), { mode: 0o600 });
  await fs.rename(tmp, file);
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10);
  const pruned: string[] = [];
  for (const f of await fs.readdir(dir)) {
    const m = NAME.exec(f);
    if (m && m[1] < cutoff) {
      await fs.rm(path.join(dir, f), { force: true });
      pruned.push(f);
    }
  }
  await audit(db, 'backup.nightly', 'lab', null, `Wrote ${path.basename(file)}${pruned.length ? `, pruned ${pruned.length}` : ''}`);
  return { file, pruned };
}

/** Runs a backup every night at 03:00 server time (and once shortly after start if today's file is missing). */
export function scheduleNightlyBackups(db: DB, dir: string, retentionDays: number): () => void {
  let timer: NodeJS.Timeout;
  const run = () => writeBackup(db, dir, retentionDays).catch((e) => console.error('Nightly backup failed:', e?.message ?? e));
  const next = () => {
    const now = new Date();
    const at = new Date(now);
    at.setHours(3, 0, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    timer = setTimeout(async () => { await run(); next(); }, at.getTime() - now.getTime());
    timer.unref();
  };
  next();
  const today = path.join(dir, `rackmap-${new Date().toISOString().slice(0, 10)}.json`);
  const first = setTimeout(() => { fs.access(today).catch(() => run()); }, 60_000);
  first.unref();
  return () => { clearTimeout(timer); clearTimeout(first); };
}
