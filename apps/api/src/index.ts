import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { systemClock } from './clock';
import { openDb } from './db/client';
import { ensureBuiltins } from './db/bootstrap';
import { createContext } from './context';
import { createApp } from './app';
import { allRoutes } from './routes';

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const config = loadConfig({ webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist') });
  const handle = await openDb();
  await ensureBuiltins(handle.db);
  const ctx = createContext(handle.db, config, systemClock);
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
