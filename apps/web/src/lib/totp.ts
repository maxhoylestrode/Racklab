/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) computed in the browser with WebCrypto. */
function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function totp(seed: string, now = Date.now(), step = 30, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(seed), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = Math.floor(now / 1000 / step);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export const secondsLeft = (now = Date.now(), step = 30) => step - (Math.floor(now / 1000) % step);

/** Password generator using the CSPRNG with rejection sampling (no modulo bias). */
export function generatePassword(length = 24, symbols = true): string {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', ...(symbols ? ['!@#$%^&*()-_=+[]{};:,.?'] : [])];
  const all = sets.join('');
  const pick = (chars: string) => {
    const limit = 256 - (256 % chars.length);
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return chars[buf[0] % chars.length];
    }
  };
  for (;;) {
    const pw = Array.from({ length }, () => pick(all)).join('');
    if (sets.every((s) => [...pw].some((c) => s.includes(c)))) return pw;
  }
}
