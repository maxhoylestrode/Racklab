import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APP_PASSWORD_MIN, VAULT_PASSWORD_MIN, type Rack, type Settings } from '@rackmap/shared';
import { api, errorMessage } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toast';
import { useVault } from '../store/vault';
import { useLab } from '../store/lab';
import { useUi, UNIT_MIN, UNIT_MAX } from '../store/ui';
import { StrengthMeter, confirmDialog, Modal } from '../components/ui';
import { Icon } from '../components/Icon';

function Section({ title, children, desc }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass grid gap-4 rounded-panel p-6 md:grid-cols-[220px_1fr] md:gap-8">
      <div>
        <h2 className="text-base font-medium text-ink">{title}</h2>
        {desc && <p className="mt-1 text-sm text-ink-2">{desc}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const settings = useFetch<Settings>('/settings');
  const { status, refresh } = useVault();
  useEffect(() => { void refresh(); }, [refresh]);
  const s = settings.data;
  const save = async (body: Partial<Settings>) => {
    try { settings.setData({ ...(s as Settings), ...(await api.patch<Settings>('/settings', body)) }); toast.success('Saved'); await refresh(); } catch (e) { toast.error(e); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-2 px-2 py-4 md:px-6">
        <h1 className="px-6 pb-2 text-lg font-medium">Settings</h1>

        <Section title="Vault" desc={<>The vault encrypts passwords, TOTP seeds and private notes with a key only your vault master password (or recovery phrase) can unlock. Usernames, IPs, URLs and ordinary notes are <strong>not</strong> encrypted.</>}>
          {!status ? null : !status.configured ? <VaultSetup onDone={() => void refresh()} /> : (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-ink"><span className={`chip ${status.unlocked ? 'chip-warn' : ''}`}><Icon name={status.unlocked ? 'unlock' : 'lock'} />{status.unlocked ? 'Unlocked' : 'Locked'}</span> Auto-locks after {s?.vault_auto_lock_minutes ?? 10} minutes of inactivity.</p>
              <label className="flex items-center gap-3 text-sm text-ink-2">Auto-lock after
                <select className="input w-auto" value={s?.vault_auto_lock_minutes ?? 10} onChange={(e) => void save({ vault_auto_lock_minutes: Number(e.target.value) })}>
                  {[1, 2, 5, 10].map((m) => <option key={m} value={m}>{m} minute{m === 1 ? '' : 's'}</option>)}
                </select>
              </label>
              <ChangePassword kind="vault" />
            </div>
          )}
        </Section>

        <Section title="App password" desc="Used to sign in to RackMap. Separate from the vault master password.">
          <ChangePassword kind="app" />
        </Section>

        <Section title="Display">
          <div className="grid gap-4 sm:grid-cols-2">
            <RackHeight />
            <label className="block"><span className="label">Default unit height ({s?.default_unit_height_px ?? 44}px)</span>
              <input type="range" min={UNIT_MIN} max={UNIT_MAX} className="mt-2 w-full" value={s?.default_unit_height_px ?? 44}
                onChange={(e) => settings.setData({ ...(s as Settings), default_unit_height_px: Number(e.target.value) })}
                onMouseUp={(e) => { const v = Number((e.target as HTMLInputElement).value); void save({ default_unit_height_px: v }); useUi.getState().setUnitPx(v); }}
                onKeyUp={(e) => { const v = Number((e.target as HTMLInputElement).value); void save({ default_unit_height_px: v }); useUi.getState().setUnitPx(v); }} />
            </label>
            <label className="block"><span className="label">Motion</span>
              <select className="input" value={useUi.getState().reducedMotion} onChange={(e) => {
                const v = e.target.value as Settings['reduced_motion'];
                useUi.getState().setReducedMotion(v);
                void save({ reduced_motion: v });
              }}>
                <option value="system">Follow system setting</option>
                <option value="reduce">Reduce motion (no LED blink or animations)</option>
                <option value="no-preference">Allow motion</option>
              </select>
            </label>
          </div>
        </Section>

        <Section title="Backup and restore" desc="The JSON export holds the whole lab. Secrets stay encrypted, so restoring it needs the vault master password from the time of export. Nightly backups are also written on the server.">
          <BackupControls />
        </Section>

        {s?.seed_present && (
          <Section title="Sample data" desc="The Home Rack sample lab was loaded on first run. Remove exactly what was seeded, leaving anything you added.">
            <button className="btn btn-danger" onClick={async () => {
              if (!(await confirmDialog({ title: 'Delete seed data?', message: 'Removes the seeded rack, devices, cables, notes, services and projects. Anything you added yourself stays.', danger: true, confirmLabel: 'Delete seed data' }))) return;
              try { const r = await api.post<{ removed: number }>('/seed/delete'); toast.success(`Removed ${r.removed} seeded records`); await useLab.getState().load(); void settings.reload(); } catch (e) { toast.error(e); }
            }}>Delete seed data</button>
          </Section>
        )}
      </div>
    </div>
  );
}

function RackHeight() {
  const { racks, rackId } = useLab();
  useEffect(() => { if (!useLab.getState().loaded) void useLab.getState().load(); }, []);
  const rack = racks.find((r) => r.id === rackId);
  const [u, setU] = useState(rack?.total_units ?? 42);
  useEffect(() => setU(rack?.total_units ?? 42), [rack?.total_units]);
  if (!rack) return null;
  return (
    <form className="block" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const r = await api.patch<Rack>(`/racks/${rack.id}`, { total_units: u });
        useLab.setState((s) => ({ racks: s.racks.map((x) => (x.id === r.id ? r : x)) }));
        toast.success(`${r.name} is now ${r.total_units}U`);
      } catch (err) { toast.error(err); }
    }}>
      <span className="label">Rack height: {rack.name}</span>
      <div className="flex gap-2"><input type="number" min={1} max={60} className="input font-mono" value={u} onChange={(e) => setU(Number(e.target.value))} aria-label="Rack height in units" /><button className="btn">Apply</button></div>
    </form>
  );
}

function ChangePassword({ kind }: { kind: 'app' | 'vault' }) {
  const min = kind === 'app' ? APP_PASSWORD_MIN : VAULT_PASSWORD_MIN;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      setErr('');
      try {
        await api.post(kind === 'app' ? '/auth/change-password' : '/vault/change-password', { current_password: cur, new_password: next });
        setCur(''); setNext('');
        toast.success(kind === 'app' ? 'App password changed' : 'Vault master password changed. Existing credentials stay readable.');
      } catch (x) { setErr(errorMessage(x)); }
    }}>
      <label><span className="label">Current {kind === 'app' ? 'app' : 'master'} password</span><input type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>
      <label><span className="label">New password</span><input type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /><StrengthMeter value={next} /></label>
      {err && <p className="text-sm text-bad sm:col-span-2" role="alert">{err}</p>}
      <div className="flex items-center gap-3 sm:col-span-2"><button className="btn" disabled={!cur || next.length < min}>Change {kind === 'app' ? 'app' : 'master'} password</button> <span className="text-xs text-ink-2">At least {min} characters.</span></div>
    </form>
  );
}

function VaultSetup({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setErr('');
        try { const r = await api.post<{ recovery_phrase: string }>('/vault/setup', { master_password: pw }); setPhrase(r.recovery_phrase); setPw(''); setPw2(''); }
        catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">Vault master password</span><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><StrengthMeter value={pw} /></label>
          <label><span className="label">Confirm</span><input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
        </div>
        <p className="text-xs text-ink-2">At least {VAULT_PASSWORD_MIN} characters, and different from the app password.</p>
        {err && <p className="text-sm text-bad" role="alert">{err}</p>}
        <button className="btn btn-primary" disabled={busy || pw.length < VAULT_PASSWORD_MIN || pw !== pw2}>{busy ? 'Creating vault…' : 'Create vault'}</button>
      </form>
      <Modal open={!!phrase} onClose={() => { if (saved) { setPhrase(null); onDone(); } }} title="Your recovery phrase" width="max-w-xl">
        <p className="text-sm">Write these 24 words down and keep them somewhere safe and offline. They unlock the vault if you forget the master password. <strong>This is the only time they are shown.</strong></p>
        <ol className="surface-inset my-4 grid grid-cols-3 gap-x-4 gap-y-2 rounded-control p-4 font-mono text-sm text-ink sm:grid-cols-4">
          {phrase?.split(' ').map((w, i) => <li key={i}><span className="mr-2 inline-block w-5 text-right text-ink-2">{i + 1}</span>{w}</li>)}
        </ol>
        <p className="flex items-start gap-2 rounded-control border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-ink"><Icon name="warning" className="mt-0.5 shrink-0 text-bad" />If you lose both the master password and this phrase, your secrets cannot be recovered by anyone.</p>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have written the recovery phrase down</label>
        <div className="mt-6 flex justify-end"><button className="btn btn-primary" disabled={!saved} onClick={() => { setPhrase(null); onDone(); }}>Done</button></div>
      </Modal>
    </>
  );
}

function BackupControls() {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn" href="/api/export" download>Download JSON export</a>
      <button className="btn" onClick={() => file.current?.click()}>Restore from JSON…</button>
      <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        let data: unknown;
        try { data = JSON.parse(await f.text()); } catch { toast.error(new Error('That file is not valid JSON')); return; }
        if (!(await confirmDialog({ title: 'Restore from backup?', message: <>This <strong>replaces everything</strong> in RackMap with the contents of {f.name}. The file is checked first; nothing changes if it is invalid. The vault locks afterwards.</>, danger: true, confirmLabel: 'Replace and restore' }))) return;
        try {
          const r = await api.post<{ counts: Record<string, number> }>('/import', data);
          toast.success(`Restored ${r.counts.devices ?? 0} devices, ${r.counts.links ?? 0} cables, ${r.counts.projects ?? 0} projects`);
          await useLab.getState().load();
          await useVault.getState().refresh();
        } catch (err) { toast.error(err); }
      }} />
    </div>
  );
}
