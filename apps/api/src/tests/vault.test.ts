/**
 * The twelve vault crypto behaviours (spec section 6), tested before any UI exists.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createVault, unlockWithPassword, unlockWithPhrase, rewrapWithPassword, seal, openString, open, deriveKek,
  isValidPhrase, AD, KDF_MIN_MEMLIMIT, KDF_MIN_OPSLIMIT, SALT_BYTES, NONCE_BYTES, KEY_BYTES, VaultCryptoError,
  type VaultMetaRecord,
} from '../crypto/vault';
import { VaultKeyStore } from '../services/vaultKeys';
import { TestClock } from '../clock';
import { authedEnv, api, APP_PASSWORD, type TestEnv } from './helpers';
import { vaultMeta } from '../db/schema';

const MASTER = 'vault master password 1';
const NEW_MASTER = 'a brand new master password';

let vault: Awaited<ReturnType<typeof createVault>>;
beforeAll(async () => {
  vault = await createVault(MASTER);
});

describe('vault crypto (unit)', () => {
  it('1. round-trips encrypt and decrypt', async () => {
    const sealed = await seal(vault.dk, 'hunter2 and some unicode: 🔐', AD.field('c1', 'secret'));
    expect(await openString(vault.dk, sealed, AD.field('c1', 'secret'))).toBe('hunter2 and some unicode: 🔐');
  });

  it('2. rejects the wrong master password', async () => {
    await expect(unlockWithPassword('not the master password', vault.meta)).rejects.toBeInstanceOf(VaultCryptoError);
    const dk = await unlockWithPassword(MASTER, vault.meta);
    expect(Buffer.from(dk).equals(Buffer.from(vault.dk))).toBe(true);
  });

  it('3. rejects tampered ciphertext, nonce or associated data', async () => {
    const sealed = await seal(vault.dk, 'secret value', AD.field('c1', 'secret'));
    const flipped = new Uint8Array(sealed.ciphertext);
    flipped[0] ^= 0x01;
    await expect(open(vault.dk, { ciphertext: flipped, nonce: sealed.nonce }, AD.field('c1', 'secret'))).rejects.toBeInstanceOf(VaultCryptoError);
    const badNonce = new Uint8Array(sealed.nonce);
    badNonce[5] ^= 0xff;
    await expect(open(vault.dk, { ciphertext: sealed.ciphertext, nonce: badNonce }, AD.field('c1', 'secret'))).rejects.toBeInstanceOf(VaultCryptoError);
    // Moving a ciphertext to another credential or field is also rejected.
    await expect(open(vault.dk, sealed, AD.field('c2', 'secret'))).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(open(vault.dk, sealed, AD.field('c1', 'notes'))).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('4. never reuses a nonce across 10,000 encryptions', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const s = await seal(vault.dk, 'x', 'ad');
      expect(s.nonce.length).toBe(NONCE_BYTES);
      seen.add(Buffer.from(s.nonce).toString('hex'));
    }
    expect(seen.size).toBe(10_000);
  });

  it('5. changing the master password keeps old credentials readable', async () => {
    const sealed = await seal(vault.dk, 'old credential', AD.field('c9', 'secret'));
    const next = await rewrapWithPassword(vault.dk, NEW_MASTER);
    const meta2: VaultMetaRecord = { ...vault.meta, ...next };
    expect(Buffer.from(meta2.kdf_salt).equals(Buffer.from(vault.meta.kdf_salt))).toBe(false); // new salt
    await expect(unlockWithPassword(MASTER, meta2)).rejects.toBeInstanceOf(VaultCryptoError);
    const dk = await unlockWithPassword(NEW_MASTER, meta2);
    expect(await openString(dk, sealed, AD.field('c9', 'secret'))).toBe('old credential');
  });

  it('6. uses argon2id with at least 64 MiB, 3 iterations, parallelism 1 and a 16 byte salt', async () => {
    const p = vault.meta.kdf_params;
    expect(p.alg).toBe('argon2id13');
    expect(p.memlimit).toBeGreaterThanOrEqual(KDF_MIN_MEMLIMIT);
    expect(p.opslimit).toBeGreaterThanOrEqual(KDF_MIN_OPSLIMIT);
    expect(p.parallelism).toBe(1);
    expect(vault.meta.kdf_salt.length).toBe(SALT_BYTES);
    expect(Buffer.from(p.salt, 'base64').equals(Buffer.from(vault.meta.kdf_salt))).toBe(true);
    await expect(deriveKek(MASTER, { ...p, memlimit: 1024 * 1024 })).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('7. generates a fresh random 32 byte data key and wraps it with a 24 byte nonce', async () => {
    const other = await createVault(MASTER);
    expect(vault.dk.length).toBe(KEY_BYTES);
    expect(Buffer.from(other.dk).equals(Buffer.from(vault.dk))).toBe(false);
    expect(vault.meta.wrapped_data_key_nonce.length).toBe(NONCE_BYTES);
    // The wrapped key does not contain the plaintext key.
    expect(Buffer.from(vault.meta.wrapped_data_key).includes(Buffer.from(vault.dk))).toBe(false);
  });

  it('8. validates unlock with the encrypted verifier', async () => {
    const tampered: VaultMetaRecord = { ...vault.meta, verifier: new Uint8Array(vault.meta.verifier).map((b, i) => (i === 0 ? b ^ 1 : b)) };
    await expect(unlockWithPassword(MASTER, tampered)).rejects.toBeInstanceOf(VaultCryptoError);
    expect(await openString(vault.dk, { ciphertext: vault.meta.verifier, nonce: vault.meta.verifier_nonce }, AD.verifier)).toBe('rackmap-vault-ok');
  });

  it('9. issues a 24 word BIP39 recovery phrase that unwraps a second copy of the data key', async () => {
    const words = vault.phrase.split(' ');
    expect(words).toHaveLength(24);
    expect(isValidPhrase(vault.phrase)).toBe(true);
    const dk = await unlockWithPhrase(`  ${vault.phrase.toUpperCase()}  `, vault.meta);
    expect(Buffer.from(dk).equals(Buffer.from(vault.dk))).toBe(true);
    const wrong = [...words.slice(1), words[0]].join(' ');
    await expect(unlockWithPhrase(wrong, vault.meta)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('10. holds the data key in memory only, auto-locks after inactivity and zeroes the buffer', () => {
    const clock = new TestClock();
    const store = new VaultKeyStore(clock, 10 * 60 * 1000);
    const key = new Uint8Array(32).fill(7);
    store.set('s1', key);
    clock.advance(9 * 60 * 1000);
    expect(store.get('s1')).toBe(key); // use refreshes the timer
    clock.advance(9 * 60 * 1000);
    expect(store.isUnlocked('s1')).toBe(true);
    clock.advance(60 * 1000 + 1);
    expect(store.get('s1')).toBeNull();
    expect(key.every((b) => b === 0)).toBe(true);

    const k2 = new Uint8Array(32).fill(9);
    store.set('s2', k2);
    store.lock('s2');
    expect(k2.every((b) => b === 0)).toBe(true);
    expect(store.isUnlocked('s2')).toBe(false);
  });
});

describe('vault API', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await authedEnv();
  });
  afterAll(async () => env.handle.close());

  it('11. enforces master password rules and keeps the database zero-knowledge', async () => {
    const a = api(env);
    expect((await a.post('/api/vault/setup', { master_password: 'too short' })).status).toBe(400);
    // 14+ chars but identical to the app password is refused. (APP_PASSWORD is 21 chars.)
    const same = await a.post('/api/vault/setup', { master_password: APP_PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('same_as_app_password');

    const ok = await a.post('/api/vault/setup', { master_password: MASTER });
    expect(ok.status).toBe(201);
    expect(ok.body.recovery_phrase.split(' ')).toHaveLength(24);
    expect((await a.post('/api/vault/setup', { master_password: MASTER })).status).toBe(409);

    // Nothing in vault_meta contains the password, the phrase or the unwrapped key.
    const dump: any = await env.handle.db.execute(sql`select * from vault_meta`);
    const text = JSON.stringify((dump.rows ?? dump), (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));
    expect(text).not.toContain(MASTER);
    expect(text).not.toContain(ok.body.recovery_phrase.split(' ')[0] + ' ' + ok.body.recovery_phrase.split(' ')[1]);
    const key = env.ctx.vaultKeys.peek(env.agent ? (await sessionId(env)) : '')!;
    expect(key).toBeDefined();
    expect(text).not.toContain(Buffer.from(key).toString('hex'));
    const audit: any = await env.handle.db.execute(sql`select summary from audit_log`);
    expect(JSON.stringify(audit.rows ?? audit)).not.toContain(MASTER);
  });

  it('12. unlock, lock, logout and change-password behave and wipe the key', async () => {
    const a = api(env);
    const sid = await sessionId(env);
    expect((await a.get('/api/vault/status')).body).toMatchObject({ configured: true, unlocked: true });
    expect((await a.post('/api/vault/lock')).status).toBe(200);
    expect((await a.get('/api/vault/status')).body.unlocked).toBe(false);
    expect((await a.post('/api/vault/touch')).status).toBe(423);

    const bad = await a.post('/api/vault/unlock', { master_password: 'nope nope nope nope' });
    expect(bad.status).toBe(401);
    env.clock.advance(2000);
    expect((await a.post('/api/vault/unlock', { master_password: MASTER })).status).toBe(200);
    expect((await a.post('/api/vault/touch')).status).toBe(200);

    // Auto-lock after 10 minutes idle.
    env.clock.advance(10 * 60 * 1000 + 1);
    expect((await a.post('/api/vault/touch')).status).toBe(423);

    // Change password: old fails, new works.
    expect((await a.post('/api/vault/change-password', { current_password: 'wrong wrong wrong', new_password: NEW_MASTER })).status).toBe(401);
    expect((await a.post('/api/vault/change-password', { current_password: MASTER, new_password: NEW_MASTER })).status).toBe(200);
    await a.post('/api/vault/lock');
    env.clock.advance(70_000);
    expect((await a.post('/api/vault/unlock', { master_password: MASTER })).status).toBe(401);
    env.clock.advance(70_000);
    expect((await a.post('/api/vault/unlock', { master_password: NEW_MASTER })).status).toBe(200);

    // Logout zeroes the in-memory key.
    const key = env.ctx.vaultKeys.peek(sid)!;
    expect(key.some((b) => b !== 0)).toBe(true);
    expect((await a.post('/api/auth/logout')).status).toBe(200);
    expect(key.every((b) => b === 0)).toBe(true);
    expect(env.ctx.vaultKeys.isUnlocked(sid)).toBe(false);

    const rows = await env.handle.db.select().from(vaultMeta);
    expect(rows).toHaveLength(1);
  });
});

/** The session id is the sha256 of the cookie token; read it from the store via the only session. */
async function sessionId(env: TestEnv): Promise<string> {
  const res: any = await env.handle.db.execute(sql`select id from sessions order by created_at desc limit 1`);
  return (res.rows ?? res)[0].id;
}
