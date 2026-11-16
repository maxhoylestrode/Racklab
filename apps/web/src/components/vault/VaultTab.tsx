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
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm dark:border-slate-700">
        <p className="font-medium">The vault is not set up yet.</p>
        <p className="mt-1 text-slate-500">Set a vault master password on the Settings page. It is separate from the app password and is needed only to reveal secrets.</p>
      </div>
    );
  }
  const svcName = (id: string | null) => services.data?.find((s) => s.id === id)?.name;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Credentials</h3>
        <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Add credential</button>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-500">Labels, usernames and URLs are stored in plain text. Passwords, TOTP seeds and private notes are encrypted with the vault key and only shown on reveal.</p>
      {!creds.data?.length && <p className="text-xs text-slate-500">No credentials for this device or its services.</p>}
      <ul className="space-y-2">
        {creds.data?.map((c) => <CredentialRow key={c.id} c={c} serviceName={svcName(c.service_id)} onChanged={() => void creds.reload()} />)}
      </ul>
      {adding && <CredentialDialog device={device} services={services.data ?? []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void creds.reload(); }} />}
    </div>
  );
}

function CredentialRow({ c, serviceName, onChanged }: { c: CredentialMeta; serviceName?: string; onChanged: () => void }) {
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
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start gap-2">
        <Icon name="key" size={14} className="mt-0.5 text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{c.label}{serviceName && <span className="ml-1 text-xs font-normal text-slate-500">· {serviceName}</span>}</div>
          <div className="truncate text-xs text-slate-500">{c.username_plain ?? 'no username'}{c.url && <> · <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-sky-500">{new URL(c.url).host}</a></>}</div>
        </div>
        {revealed
          ? <button className="btn btn-sm" onClick={hide}><Icon name="eyeOff" size={12} /> Hide</button>
          : <button className="btn btn-sm" onClick={() => void reveal()}><Icon name="eye" size={12} /> Reveal</button>}
        <button className="btn btn-ghost btn-sm" aria-label={`Delete ${c.label}`} onClick={async () => {
          if (!(await confirmDialog({ title: 'Delete credential?', message: `Delete "${c.label}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return;
          try { await api.del(`/credentials/${c.id}`); onChanged(); } catch (e) { toast.error(e); }
        }}><Icon name="trash" size={12} /></button>
      </div>
      {revealed && (
        <div className="mt-2 space-y-2 rounded-md bg-slate-100 p-2 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-sm">{revealed.secret}</code>
            <button className="btn btn-sm" onClick={() => void copySecret(revealed.secret, 'Password')}><Icon name="copy" size={12} /> Copy</button>
          </div>
          {revealed.totp_seed && <TotpCode seed={revealed.totp_seed} />}
          {revealed.private_notes && <p className="whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{revealed.private_notes}</p>}
          <div className="h-1 overflow-hidden rounded bg-slate-300 dark:bg-slate-700" aria-label={`Hides in ${Math.ceil(left / 1000)} seconds`}>
            <div className="h-full bg-amber-500 transition-[width] duration-200" style={{ width: `${(left / REVEAL_MS) * 100}%` }} />
          </div>
        </div>
      )}
      {c.last_revealed_at && <p className="mt-1 text-[10px] text-slate-500">Last revealed {new Date(c.last_revealed_at).toLocaleString()}</p>}
    </li>
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
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">TOTP</span>
      <code className="font-mono text-lg tracking-widest">{code.slice(0, 3)} {code.slice(3)}</code>
      <svg width={18} height={18} viewBox="0 0 20 20" aria-label={`${secs} seconds left`}>
        <circle cx={10} cy={10} r={8} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
        <circle cx={10} cy={10} r={8} fill="none" stroke="#38bdf8" strokeWidth={3} strokeDasharray={`${(secs / 30) * 50.3} 50.3`} transform="rotate(-90 10 10)" />
      </svg>
      <button className="btn btn-ghost btn-sm ml-auto" onClick={() => void copySecret(code, 'Code')}><Icon name="copy" size={12} /></button>
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
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">Length <input type="range" min={12} max={64} value={len} onChange={(e) => setLen(Number(e.target.value))} aria-label="Generated length" className="accent-sky-500" /> {len}</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={symbols} onChange={(e) => setSymbols(e.target.checked)} /> Symbols</label>
          </div>
        </div>
        <label className="col-span-2"><span className="label">TOTP seed (optional, base32)</span><input className="input font-mono" value={f.totp_seed} onChange={(e) => set('totp_seed', e.target.value)} autoComplete="off" /></label>
        <label className="col-span-2"><span className="label">Private notes (encrypted)</span><textarea className="input" rows={2} value={f.private_notes} onChange={(e) => set('private_notes', e.target.value)} /></label>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save credential</button></div>
      </form>
    </Modal>
  );
}
