import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { systemClock } from './clock';
import { openDb } from './db/client';
import { ensureBuiltins } from './db/bootstrap';
import { seedOnFirstRun } from './db/seed';
import { createContext } from './context';
import { createApp } from './app';
import { allRoutes } from './routes';
import { applyVaultSettings } from './services/vault';
import { scheduleNightlyBackups } from './services/nightly';

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const config = loadConfig({ webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist') });
  const handle = await openDb();
  await ensureBuiltins(handle.db);
  if (process.env.SKIP_SEED !== 'true' && (await seedOnFirstRun(handle.db))) console.log('Loaded seed lab (Home Rack)');
  const ctx = createContext(handle.db, config, systemClock);
  await applyVaultSettings(ctx);
  ctx.vaultKeys.startSweeper();
  if (process.env.BACKUPS_ENABLED !== 'false') scheduleNightlyBackups(handle.db, config.backupDir, config.backupRetentionDays);
  const app = createApp(ctx, allRoutes);
  const server = app.listen(config.port, () => {
    console.log(`RackMap listening on :${config.port} (db: ${handle.kind})`);
  });
  const shutdown = async () => {
    server.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
