import { useEffect, useRef, useState } from 'react';
import type { CredentialMeta, Device, RevealedCredential, Service } from '@rackmap/shared';
import { useFetch } from '../../lib/useFetch';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../store/toast';
import { useVault } from '../../store/vault';
import { generatePassword, totp, secondsLeft } from '../../lib/totp';
import { Modal, confirmDialog } from '../ui';
import { Icon } from '../Icon';

const REVEAL_MS = 15_000;
const CLIPBOARD_CLEAR_MS = 30_000;

/** Runs `fn`, prompting for the master password and retrying once if the vault is locked. */
async function withVault<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'vault_locked') {
      if (!(await useVault.getState().ensureUnlocked())) return null;
      return fn();
    }
    throw e;
  }
}

/** Copies, then clears the clipboard after 30 s if it still holds our value (where the browser allows reading it). */
async function copySecret(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.info(`${what} copied. The clipboard clears in 30 seconds.`);
    setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText().catch(() => value);
        if (current === value) await navigator.clipboard.writeText('');
      } catch { /* browser does not allow it */ }
    }, CLIPBOARD_CLEAR_MS);
  } catch {
    toast.warn('The browser blocked clipboard access.');
  }
}

export function VaultTab({ device }: { device: Device }) {
  const creds = useFetch<CredentialMeta[]>(`/credentials?device_id=${device.id}`, [device.id]);
  const services = useFetch<Service[]>(`/services?device_id=${device.id}`, [device.id]);
  const { status, refresh } = useVault();
  const [adding, setAdding] = useState(false);
  useEffect(() => { void refresh(); }, [refresh]);

  if (status && !status.configured) {
    return (
      <div className="vault-panel rounded-panel p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-ink"><Icon name="lock" className="text-ink-2" />The vault is not set up yet.</p>
        <p className="mt-1 text-ink-2">Set a vault master password on the Settings page. It is separate from the app password and is needed only to reveal secrets.</p>
      </div>
    );
  }
  const svcName = (id: string | null) => services.data?.find((s) => s.id === id)?.name;
  const locked = !status?.unlocked;
  return (
    <div>
      <div className="mb-3 flex h-8 items-center justify-between">
        <h3 className="text-sm font-medium">Credentials</h3>
        <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" /> Add credential</button>
      </div>
      <div className={`mb-3 flex items-start gap-3 rounded-panel border px-3 py-3 text-xs ${locked ? 'border-line-strong bg-panel-sunk text-ink-2' : 'border-warn/30 bg-warn/5 text-ink'}`} role="status">
        <Icon name={locked ? 'lock' : 'unlock'} className={`mt-0.5 shrink-0 ${locked ? 'text-ink-2' : 'text-warn'}`} />
        <p>{locked
          ? 'Locked. Secrets stay encrypted; Reveal asks for the master password.'
          : 'Unlocked. Revealed secrets hide again after 15 seconds.'}
          {' '}Labels, usernames and URLs are plain text.</p>
      </div>
      {!creds.data?.length && <p className="text-sm text-ink-2">No credentials for this device or its services.</p>}
      <ul className={`space-y-2 ${locked ? '[&_.icon-tile]:opacity-50 [&_.vault-panel]:bg-panel-sunk' : ''}`}>
        {creds.data?.map((c) => <CredentialRow key={c.id} c={c} locked={locked} serviceName={svcName(c.service_id)} onChanged={() => void creds.reload()} />)}
      </ul>
      {adding && <CredentialDialog device={device} services={services.data ?? []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void creds.reload(); }} />}
    </div>
  );
}

function CredentialRow({ c, locked, serviceName, onChanged }: { c: CredentialMeta; locked: boolean; serviceName?: string; onChanged: () => void }) {
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [left, setLeft] = useState(0);
  const timer = useRef<number>();
  useEffect(() => () => window.clearInterval(timer.current), []);

  const reveal = async () => {
    try {
      const r = await withVault(() => api.post<RevealedCredential>(`/credentials/${c.id}/reveal`));
      if (!r) return;
      setRevealed(r);
      const until = Date.now() + REVEAL_MS;
      setLeft(REVEAL_MS);
      window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        const l = until - Date.now();
        if (l <= 0) { setRevealed(null); window.clearInterval(timer.current); }
        setLeft(Math.max(0, l));
      }, 250);
    } catch (e) { toast.error(e); }
  };
  const hide = () => { setRevealed(null); window.clearInterval(timer.current); };

  return (
    <li className="vault-panel rounded-panel p-3">
      <div className="flex items-center gap-3">
        <span className="icon-tile"><Icon name={locked ? 'lock' : 'key'} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{c.label}{serviceName && <span className="ml-1 text-xs font-normal text-ink-2">· {serviceName}</span>}</div>
          <div className="truncate text-xs text-ink-2"><span className="font-mono">{c.username_plain ?? 'no username'}</span>{c.url && <> · <a href={c.url} target="_blank" rel="noopener noreferrer" className="link">{new URL(c.url).host}</a></>}</div>
        </div>
        {revealed
          ? <button className="btn btn-sm" onClick={hide}><Icon name="eyeOff" /> Hide</button>
          : <button className="btn btn-sm" onClick={() => void reveal()}><Icon name="eye" /> Reveal</button>}
        <button className="btn btn-ghost btn-sm" aria-label={`Delete ${c.label}`} onClick={async () => {
          if (!(await confirmDialog({ title: 'Delete credential?', message: `Delete "${c.label}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return;
          try { await api.del(`/credentials/${c.id}`); onChanged(); } catch (e) { toast.error(e); }
        }}><Icon name="trash" size={12} /></button>
      </div>
      {revealed && (
        <div className="secret-field mt-3 space-y-3 rounded-control p-3">
          <div className="flex items-center gap-3">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-md">{revealed.secret}</code>
            <Countdown left={left} total={REVEAL_MS} />
            <button className="btn btn-sm" onClick={() => void copySecret(revealed.secret, 'Password')}><Icon name="copy" /> Copy</button>
          </div>
          {revealed.totp_seed && <TotpCode seed={revealed.totp_seed} />}
          {revealed.private_notes && <p className="whitespace-pre-wrap border-t border-white/10 pt-3 text-xs text-white/75">{revealed.private_notes}</p>}
        </div>
      )}
      {c.last_revealed_at && <p className="mt-2 text-xs text-ink-2">Last revealed <span className="font-mono">{new Date(c.last_revealed_at).toLocaleString()}</span></p>}
    </li>
  );
}

/** Countdown ring with the seconds left in the middle. */
function Countdown({ left, total }: { left: number; total: number }) {
  const r = 11, c = 2 * Math.PI * r;
  const s = Math.ceil(left / 1000);
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center" role="timer" aria-label={`Hides in ${s} seconds`}>
      <svg width={28} height={28} viewBox="0 0 28 28" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={14} cy={14} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={2} />
        <circle cx={14} cy={14} r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={`${(left / total) * c} ${c}`} className="transition-[stroke-dasharray] duration-base" />
      </svg>
      <span className="font-mono text-xs">{s}</span>
    </span>
  );
}

function TotpCode({ seed }: { seed: string }) {
  const [code, setCode] = useState('······');
  const [secs, setSecs] = useState(secondsLeft());
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const c = await totp(seed); if (alive) setCode(c); } catch { if (alive) setCode('invalid'); }
      if (alive) setSecs(secondsLeft());
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [seed]);
  return (
    <div className="flex items-center gap-3 border-t border-white/10 pt-3">
      <span className="w-10 text-2xs font-medium uppercase tracking-label text-white/75">TOTP</span>
      <code className="flex-1 font-mono text-lg tracking-[0.18em]">{code.slice(0, 3)} {code.slice(3)}</code>
      <Countdown left={secs * 1000} total={30_000} />
      <button className="btn btn-sm" aria-label="Copy TOTP code" onClick={() => void copySecret(code, 'Code')}><Icon name="copy" /></button>
    </div>
  );
}

function CredentialDialog({ device, services, onClose, onSaved }: { device: Device; services: Service[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ label: '', username_plain: '', secret: '', totp_seed: '', url: '', private_notes: '', owner: `d:${device.id}` });
  const [len, setLen] = useState(24);
  const [symbols, setSymbols] = useState(true);
  const [show, setShow] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} title="Add credential" width="max-w-lg">
      <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const [kind, id] = f.owner.split(':');
        const body = {
          device_id: kind === 'd' ? id : null, service_id: kind === 's' ? id : null, label: f.label, username_plain: f.username_plain || null,
          secret: f.secret, totp_seed: f.totp_seed || null, url: f.url || null, private_notes: f.private_notes || null,
        };
        try {
          const r = await withVault(() => api.post('/credentials', body));
          if (r) { toast.success('Credential saved'); onSaved(); }
        } catch (err) { toast.error(err); }
      }}>
        <label className="col-span-2"><span className="label">Label</span><input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="iDRAC root" required autoFocus /></label>
        <label className="col-span-2"><span className="label">Belongs to</span>
          <select className="input" value={f.owner} onChange={(e) => set('owner', e.target.value)}>
            <option value={`d:${device.id}`}>{device.name} (device)</option>
            {services.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name} (service)</option>)}
          </select>
        </label>
        <label><span className="label">Username</span><input className="input" value={f.username_plain} onChange={(e) => set('username_plain', e.target.value)} autoComplete="off" /></label>
        <label><span className="label">URL</span><input type="url" className="input" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" /></label>
        <div className="col-span-2">
          <label className="label" htmlFor="cred-secret">Password</label>
          <div className="flex gap-1">
            <input id="cred-secret" type={show ? 'text' : 'password'} className="input font-mono" value={f.secret} onChange={(e) => set('secret', e.target.value)} required autoComplete="new-password" />
            <button type="button" className="btn btn-sm" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}><Icon name={show ? 'eyeOff' : 'eye'} size={13} /></button>
            <button type="button" className="btn btn-sm" onClick={() => { set('secret', generatePassword(len, symbols)); setShow(true); }}>Generate</button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2">Length <input type="range" min={12} max={64} value={len} onChange={(e) => setLen(Number(e.target.value))} aria-label="Generated length" /> <span className="w-6 font-mono">{len}</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={symbols} onChange={(e) => setSymbols(e.target.checked)} /> Symbols</label>
          </div>
        </div>
        <label className="col-span-2"><span className="label">TOTP seed (optional, base32)</span><input className="input font-mono" value={f.totp_seed} onChange={(e) => set('totp_seed', e.target.value)} autoComplete="off" /></label>
        <label className="col-span-2"><span className="label">Private notes (encrypted)</span><textarea className="input" rows={2} value={f.private_notes} onChange={(e) => set('private_notes', e.target.value)} /></label>
        <div className="col-span-2 mt-2 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save credential</button></div>
      </form>
    </Modal>
  );
}
