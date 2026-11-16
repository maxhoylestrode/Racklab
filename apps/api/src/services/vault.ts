import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { DB } from '../db/client';
import { vaultMeta, appSettings } from '../db/schema';
import { HttpError } from '../errors';
import type { VaultMetaRecord } from '../crypto/vault';

export async function loadVaultMeta(db: DB): Promise<VaultMetaRecord | null> {
  const [row] = await db.select().from(vaultMeta).where(eq(vaultMeta.id, 1)).limit(1);
  return row ?? null;
}

/** Returns the session's data key or throws 423 (Locked) so the UI can prompt for the master password. */
export function requireDataKey(ctx: AppContext, req: Request): Uint8Array {
  const key = ctx.vaultKeys.get(req.session!.id);
  if (!key) throw new HttpError(423, 'The vault is locked', 'vault_locked');
  return key;
}

/** Apply the auto-lock timeout from settings (capped at the spec's 10 minutes). */
export async function applyVaultSettings(ctx: AppContext): Promise<void> {
  const [s] = await ctx.db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  const minutes = Math.min(10, Math.max(1, s?.vault_auto_lock_minutes ?? 10));
  ctx.vaultKeys.idleMs = minutes * 60 * 1000;
}
