import type { Clock } from '../clock';
import { sodium } from '../crypto/sodium';

interface Entry { key: Uint8Array; lastUsed: number }

/**
 * Holds unwrapped vault data keys in process memory only, one per session id.
 * A key is dropped (and its buffer zeroed) after `idleMs` without use, on lock, on logout,
 * or when its session ends. Never persisted or logged.
 */
export class VaultKeyStore {
  private keys = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private clock: Clock, public idleMs = 10 * 60 * 1000) {}

  startSweeper(intervalMs = 30_000) {
    this.timer ??= setInterval(() => this.sweep(), intervalMs);
    this.timer.unref();
  }

  stopSweeper() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  set(sessionId: string, key: Uint8Array) {
    this.lock(sessionId);
    this.keys.set(sessionId, { key, lastUsed: this.clock.now() });
  }

  /** Returns the key if unlocked and not idle-expired, refreshing its idle timer. */
  get(sessionId: string): Uint8Array | null {
    const e = this.keys.get(sessionId);
    if (!e) return null;
    if (this.clock.now() - e.lastUsed >= this.idleMs) {
      this.lock(sessionId);
      return null;
    }
    e.lastUsed = this.clock.now();
    return e.key;
  }

  isUnlocked(sessionId: string): boolean {
    const e = this.keys.get(sessionId);
    return !!e && this.clock.now() - e.lastUsed < this.idleMs;
  }

  /** Milliseconds until auto-lock, or 0 when locked. Does not refresh the timer. */
  remainingMs(sessionId: string): number {
    const e = this.keys.get(sessionId);
    if (!e) return 0;
    return Math.max(0, this.idleMs - (this.clock.now() - e.lastUsed));
  }

  lock(sessionId: string) {
    const e = this.keys.get(sessionId);
    if (!e) return;
    zeroNow(e.key);
    this.keys.delete(sessionId);
  }

  lockAll() {
    for (const id of [...this.keys.keys()]) this.lock(id);
  }

  sweep() {
    const now = this.clock.now();
    for (const [id, e] of this.keys) if (now - e.lastUsed >= this.idleMs) this.lock(id);
  }

  /** For tests: the raw buffer reference, to prove it gets zeroed. */
  peek(sessionId: string): Uint8Array | undefined {
    return this.keys.get(sessionId)?.key;
  }
}

let memzero: ((b: Uint8Array) => void) | null = null;
void sodium().then((s) => { memzero = (b) => s.memzero(b); });
function zeroNow(buf: Uint8Array) {
  if (memzero) memzero(buf);
  else buf.fill(0);
}
