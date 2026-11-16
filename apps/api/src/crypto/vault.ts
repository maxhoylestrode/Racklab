/**
 * Vault cryptography (spec section 6). Only libsodium primitives are used:
 *  - KEK = argon2id(master password, 16 byte salt, >= 64 MiB, 3 iterations, parallelism 1)
 *  - DK  = 32 random bytes
 *  - wrap / encrypt = XChaCha20-Poly1305 (IETF) with a fresh random 24 byte nonce per value
 * Nothing in here touches the database or logs.
 */
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sodium } from './sodium';

export const KDF_MIN_MEMLIMIT = 64 * 1024 * 1024;
export const KDF_MIN_OPSLIMIT = 3;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const VERIFIER_PLAINTEXT = 'rackmap-vault-ok';

export interface KdfParams {
  alg: 'argon2id13';
  salt: string; // base64
  opslimit: number;
  memlimit: number;
  parallelism: 1;
}

export interface Sealed {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export class VaultCryptoError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export async function newKdfParams(opts: { opslimit?: number; memlimit?: number } = {}): Promise<KdfParams> {
  const s = await sodium();
  const opslimit = Math.max(opts.opslimit ?? KDF_MIN_OPSLIMIT, KDF_MIN_OPSLIMIT);
  const memlimit = Math.max(opts.memlimit ?? KDF_MIN_MEMLIMIT, KDF_MIN_MEMLIMIT);
  return { alg: 'argon2id13', salt: b64(s.randombytes_buf(SALT_BYTES)), opslimit, memlimit, parallelism: 1 };
}

/** Derive a key-encryption key. libsodium's argon2id always uses parallelism 1. */
export async function deriveKek(secret: string, params: KdfParams): Promise<Uint8Array> {
  const s = await sodium();
  if (params.alg !== 'argon2id13') throw new VaultCryptoError('Unsupported KDF');
  if (params.opslimit < KDF_MIN_OPSLIMIT || params.memlimit < KDF_MIN_MEMLIMIT) throw new VaultCryptoError('KDF parameters below minimum');
  const salt = unb64(params.salt);
  if (salt.length !== SALT_BYTES) throw new VaultCryptoError('Bad salt');
  return s.crypto_pwhash(KEY_BYTES, secret, salt, params.opslimit, params.memlimit, s.crypto_pwhash_ALG_ARGON2ID13);
}

export async function randomKey(): Promise<Uint8Array> {
  const s = await sodium();
  return s.randombytes_buf(KEY_BYTES);
}

/** XChaCha20-Poly1305 seal with a fresh random nonce. `ad` binds the ciphertext to its context. */
export async function seal(key: Uint8Array, plaintext: Uint8Array | string, ad: string): Promise<Sealed> {
  const s = await sodium();
  if (key.length !== KEY_BYTES) throw new VaultCryptoError('Bad key length');
  const nonce = s.randombytes_buf(NONCE_BYTES);
  const msg = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, enc.encode(ad), null, nonce, key);
  return { ciphertext, nonce };
}

/** Opens a sealed value; throws VaultCryptoError if the key is wrong or anything was tampered with. */
export async function open(key: Uint8Array, sealed: Sealed, ad: string): Promise<Uint8Array> {
  const s = await sodium();
  if (sealed.nonce.length !== NONCE_BYTES) throw new VaultCryptoError('Bad nonce');
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sealed.ciphertext, enc.encode(ad), sealed.nonce, key);
  } catch {
    throw new VaultCryptoError('Decryption failed');
  }
}

export async function openString(key: Uint8Array, sealed: Sealed, ad: string): Promise<string> {
  const pt = await open(key, sealed, ad);
  const out = dec.decode(pt);
  await zero(pt);
  return out;
}

export async function zero(buf: Uint8Array): Promise<void> {
  const s = await sodium();
  s.memzero(buf);
}

// Associated-data labels: a ciphertext only opens in the slot it was written for.
export const AD = {
  wrappedDk: 'rackmap:v1:dk',
  recoveryDk: 'rackmap:v1:dk-recovery',
  verifier: 'rackmap:v1:verifier',
  field: (credentialId: string, field: 'secret' | 'totp' | 'notes') => `rackmap:v1:credential:${credentialId}:${field}`,
};

// ---------- recovery phrase ----------
export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256); // 256 bits -> 24 words
}
export function normalisePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}
export function isValidPhrase(phrase: string): boolean {
  const p = normalisePhrase(phrase);
  return p.split(' ').length === 24 && validateMnemonic(p, wordlist);
}

// ---------- vault lifecycle ----------
export interface VaultMetaRecord {
  kdf_salt: Uint8Array;
  kdf_params: KdfParams;
  wrapped_data_key: Uint8Array;
  wrapped_data_key_nonce: Uint8Array;
  verifier: Uint8Array;
  verifier_nonce: Uint8Array;
  recovery_kdf_params: KdfParams;
  recovery_wrapped_data_key: Uint8Array;
  recovery_wrapped_data_key_nonce: Uint8Array;
}

/** First-time setup: returns the vault_meta record, the recovery phrase (show once) and the DK. */
export async function createVault(masterPassword: string, kdfOpts?: { opslimit?: number; memlimit?: number }) {
  const dk = await randomKey();
  const params = await newKdfParams(kdfOpts);
  const kek = await deriveKek(masterPassword, params);
  const wrapped = await seal(kek, dk, AD.wrappedDk);
  await zero(kek);

  const phrase = newRecoveryPhrase();
  const rparams = await newKdfParams(kdfOpts);
  const rkek = await deriveKek(normalisePhrase(phrase), rparams);
  const rwrapped = await seal(rkek, dk, AD.recoveryDk);
  await zero(rkek);

  const verifier = await seal(dk, VERIFIER_PLAINTEXT, AD.verifier);
  const meta: VaultMetaRecord = {
    kdf_salt: unb64(params.salt),
    kdf_params: params,
    wrapped_data_key: wrapped.ciphertext,
    wrapped_data_key_nonce: wrapped.nonce,
    verifier: verifier.ciphertext,
    verifier_nonce: verifier.nonce,
    recovery_kdf_params: rparams,
    recovery_wrapped_data_key: rwrapped.ciphertext,
    recovery_wrapped_data_key_nonce: rwrapped.nonce,
  };
  return { meta, phrase, dk };
}

async function checkVerifier(dk: Uint8Array, meta: VaultMetaRecord): Promise<void> {
  const v = await openString(dk, { ciphertext: meta.verifier, nonce: meta.verifier_nonce }, AD.verifier);
  if (v !== VERIFIER_PLAINTEXT) throw new VaultCryptoError('Verifier mismatch');
}

/** Unwraps DK with the master password. Throws VaultCryptoError on a wrong password. */
export async function unlockWithPassword(masterPassword: string, meta: VaultMetaRecord): Promise<Uint8Array> {
  const kek = await deriveKek(masterPassword, meta.kdf_params);
  try {
    const dk = await open(kek, { ciphertext: meta.wrapped_data_key, nonce: meta.wrapped_data_key_nonce }, AD.wrappedDk);
    await checkVerifier(dk, meta);
    return dk;
  } finally {
    await zero(kek);
  }
}

export async function unlockWithPhrase(phrase: string, meta: VaultMetaRecord): Promise<Uint8Array> {
  if (!isValidPhrase(phrase)) throw new VaultCryptoError('Invalid recovery phrase');
  const kek = await deriveKek(normalisePhrase(phrase), meta.recovery_kdf_params);
  try {
    const dk = await open(kek, { ciphertext: meta.recovery_wrapped_data_key, nonce: meta.recovery_wrapped_data_key_nonce }, AD.recoveryDk);
    await checkVerifier(dk, meta);
    return dk;
  } finally {
    await zero(kek);
  }
}

/** Re-wraps DK under a new password and new salt. Credentials are untouched (they use DK). */
export async function rewrapWithPassword(dk: Uint8Array, newPassword: string, kdfOpts?: { opslimit?: number; memlimit?: number }) {
  const params = await newKdfParams(kdfOpts);
  const kek = await deriveKek(newPassword, params);
  const wrapped = await seal(kek, dk, AD.wrappedDk);
  await zero(kek);
  return {
    kdf_salt: unb64(params.salt),
    kdf_params: params,
    wrapped_data_key: wrapped.ciphertext,
    wrapped_data_key_nonce: wrapped.nonce,
  };
}
