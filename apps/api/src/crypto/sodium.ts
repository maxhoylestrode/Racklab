import _sodium from 'libsodium-wrappers-sumo';

let ready: Promise<typeof _sodium> | null = null;
/** libsodium must finish initialising (WASM) before use. */
export function sodium(): Promise<typeof _sodium> {
  ready ??= _sodium.ready.then(() => _sodium);
  return ready;
}
