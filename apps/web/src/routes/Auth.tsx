import { useState, type ReactNode } from 'react';
import { APP_PASSWORD_MIN } from '@rackmap/shared';
import { useAuth } from '../store/auth';
import { ApiError, errorMessage } from '../lib/api';
import { StrengthMeter } from '../components/ui';
import { Logo } from '../components/Logo';

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#1e293b_0%,_#0b0f17_60%)] p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function SetupScreen() {
  const setup = useAuth((s) => s.setup);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tooShort = pw.length > 0 && pw.length < APP_PASSWORD_MIN;
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <Shell title="Welcome to RackMap" subtitle="Set the app password. This screen appears only once.">
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < APP_PASSWORD_MIN || pw !== pw2) return;
        setBusy(true); setErr('');
        try { await setup(pw); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <label className="label" htmlFor="setup-pw">App password</label>
        <input id="setup-pw" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus aria-describedby="setup-pw-help" />
        <StrengthMeter value={pw} />
        <p id="setup-pw-help" className={`mt-1 text-xs ${tooShort ? 'text-rose-500' : 'text-slate-500'}`}>At least {APP_PASSWORD_MIN} characters.</p>
        <label className="label mt-4" htmlFor="setup-pw2">Confirm password</label>
        <input id="setup-pw2" type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {mismatch && <p className="mt-1 text-xs text-rose-500">Passwords do not match.</p>}
        {err && <p className="mt-3 text-sm text-rose-500" role="alert">{err}</p>}
        <button className="btn btn-primary mt-5 w-full" disabled={busy || pw.length < APP_PASSWORD_MIN || pw !== pw2}>
          {busy ? 'Setting up…' : 'Set password and continue'}
        </button>
        <p className="mt-4 text-xs text-slate-500">The vault for credentials has its own, separate master password. You set it later.</p>
      </form>
    </Shell>
  );
}

export function LoginScreen() {
  const login = useAuth((s) => s.login);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="RackMap" subtitle="Sign in to your homelab">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setErr('');
        try {
          await login(pw);
        } catch (x) {
          if (x instanceof ApiError && x.status === 429) {
            const s = (x.details as any)?.retry_after_s;
            setErr(s ? `Too many attempts. Try again in ${s > 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`}.` : x.message);
          } else setErr(errorMessage(x));
          setPw('');
        } finally { setBusy(false); }
      }}>
        <label className="label" htmlFor="login-pw">App password</label>
        <input id="login-pw" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus />
        {err && <p className="mt-3 text-sm text-rose-500" role="alert">{err}</p>}
        <button className="btn btn-primary mt-5 w-full" disabled={busy || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Shell>
  );
}
