import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { vaultSetupSchema, vaultUnlockSchema, vaultChangePasswordSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah, parse, HttpError, conflict } from '../errors';
import { appUser, vaultMeta } from '../db/schema';
import { verifyPassword } from '../services/auth';
import { audit } from '../services/audit';
import { loadVaultMeta, requireDataKey } from '../services/vault';
import { createVault, unlockWithPassword, unlockWithPhrase, rewrapWithPassword, VaultCryptoError, zero } from '../crypto/vault';

// Tiny in-memory throttle for unlock attempts per session (the KDF is already slow by design).
const unlockFailures = new Map<string, { n: number; until: number }>();

export function vaultRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/vault/status', ah(async (req, res) => {
    const meta = await loadVaultMeta(db);
    const sid = req.session!.id;
    res.json({
      configured: !!meta,
      unlocked: !!meta && ctx.vaultKeys.isUnlocked(sid),
      auto_lock_ms: ctx.vaultKeys.idleMs,
      remaining_ms: ctx.vaultKeys.remainingMs(sid),
    });
  }));

  r.post('/vault/setup', ah(async (req, res) => {
    const { master_password } = parse(vaultSetupSchema, req.body);
    if (await loadVaultMeta(db)) throw conflict('The vault is already set up', 'vault_exists');
    const [user] = await db.select().from(appUser).limit(1);
    if (user && (await verifyPassword(user.password_hash, master_password))) {
      throw new HttpError(400, 'The vault master password must be different from the app password', 'same_as_app_password');
    }
    const { meta, phrase, dk } = await createVault(master_password);
    const inserted = await db.insert(vaultMeta).values({ id: 1, ...toRow(meta) }).onConflictDoNothing().returning({ id: vaultMeta.id });
    if (inserted.length === 0) {
      await zero(dk);
      throw conflict('The vault is already set up', 'vault_exists');
    }
    ctx.vaultKeys.set(req.session!.id, dk);
    await audit(db, 'vault.setup', 'vault', '1', 'Vault created');
    // The phrase is returned exactly once and never stored.
    res.status(201).json({ ok: true, recovery_phrase: phrase });
  }));

  r.post('/vault/unlock', ah(async (req, res) => {
    const sid = req.session!.id;
    const f = unlockFailures.get(sid);
    if (f && f.until > ctx.clock.now()) {
      throw new HttpError(429, 'Too many attempts. Wait a moment.', 'rate_limited', { retry_after_s: Math.ceil((f.until - ctx.clock.now()) / 1000) });
    }
    const body = parse(vaultUnlockSchema, req.body);
    const meta = await loadVaultMeta(db);
    if (!meta) throw new HttpError(409, 'The vault has not been set up', 'vault_not_configured');
    try {
      const dk = 'master_password' in body
        ? await unlockWithPassword(body.master_password, meta)
        : await unlockWithPhrase(body.recovery_phrase, meta);
      ctx.vaultKeys.set(sid, dk);
      unlockFailures.delete(sid);
      await audit(db, 'vault.unlock', 'vault', '1', 'master_password' in body ? 'Unlocked' : 'Unlocked with recovery phrase');
      res.json({ ok: true, auto_lock_ms: ctx.vaultKeys.idleMs });
    } catch (e) {
      if (!(e instanceof VaultCryptoError)) throw e;
      const n = (f?.n ?? 0) + 1;
      unlockFailures.set(sid, { n, until: ctx.clock.now() + 1000 * 2 ** Math.min(n - 1, 6) });
      await audit(db, 'vault.unlock_failed', 'vault', '1', 'Wrong master password or phrase');
      throw new HttpError(401, 'Wrong master password', 'bad_vault_password');
    }
  }));

  r.post('/vault/lock', ah(async (req, res) => {
    ctx.vaultKeys.lock(req.session!.id);
    await audit(db, 'vault.lock', 'vault', '1');
    res.json({ ok: true });
  }));

  r.post('/vault/change-password', ah(async (req, res) => {
    const { current_password, new_password } = parse(vaultChangePasswordSchema, req.body);
    const meta = await loadVaultMeta(db);
    if (!meta) throw new HttpError(409, 'The vault has not been set up', 'vault_not_configured');
    const [user] = await db.select().from(appUser).limit(1);
    if (user && (await verifyPassword(user.password_hash, new_password))) {
      throw new HttpError(400, 'The vault master password must be different from the app password', 'same_as_app_password');
    }
    let dk: Uint8Array;
    try {
      dk = await unlockWithPassword(current_password, meta);
    } catch (e) {
      if (e instanceof VaultCryptoError) throw new HttpError(401, 'Current master password is wrong', 'bad_vault_password');
      throw e;
    }
    const next = await rewrapWithPassword(dk, new_password);
    await db.update(vaultMeta).set({ ...toBuffers(next), updated_at: sql`now()` }).where(eq(vaultMeta.id, 1));
    ctx.vaultKeys.set(req.session!.id, dk);
    await audit(db, 'vault.password_changed', 'vault', '1');
    res.json({ ok: true });
  }));

  // Lets the UI check the vault is unlocked without revealing anything.
  r.post('/vault/touch', ah(async (req, res) => {
    requireDataKey(ctx, req);
    res.json({ ok: true, remaining_ms: ctx.vaultKeys.remainingMs(req.session!.id) });
  }));

  return r;
}

function toBuffers(o: object): any {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = v instanceof Uint8Array ? Buffer.from(v) : v;
  return out;
}
const toRow = (m: object) => toBuffers(m);
