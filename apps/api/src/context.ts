import type { DB } from './db/client';
import type { Config } from './config';
import type { Clock } from './clock';
import { LoginLimiter, SessionStore } from './services/auth';
import { VaultKeyStore } from './services/vaultKeys';

export interface AppContext {
  db: DB;
  config: Config;
  clock: Clock;
  sessions: SessionStore;
  limiter: LoginLimiter;
  vaultKeys: VaultKeyStore;
  /** Called when a session ends (logout) so per-session secrets can be wiped. */
  onSessionEnd: Array<(sessionId: string) => void>;
}

export function createContext(db: DB, config: Config, clock: Clock): AppContext {
  const vaultKeys = new VaultKeyStore(clock);
  return {
    db,
    config,
    clock,
    sessions: new SessionStore(db, clock, config),
    limiter: new LoginLimiter(db, clock),
    vaultKeys,
    onSessionEnd: [(sid) => vaultKeys.lock(sid)],
  };
}
