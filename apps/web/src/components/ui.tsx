import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '../store/toast';
import { useVault } from '../store/vault';
import { errorMessage } from '../lib/api';
import { Actions, Dialog, EmptyState, PANEL_EASE } from './primitives';
import { Icon } from './Icon';

/** Dialogs are the Dialog primitive; Modal stays as the name the screens import. */
export const Modal = Dialog;

type ConfirmReq = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void };
let confirmSetter: ((r: ConfirmReq | null) => void) | null = null;
/** Promise-based confirm dialog (never window.confirm). */
export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => confirmSetter?.({ ...opts, resolve }));
}
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => { confirmSetter = setReq; return () => { confirmSetter = null; }; }, []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  return (
    <Modal open={!!req} onClose={() => close(false)} title={req?.title ?? ''}>
      <div className="text-sm text-ink-2">{req?.message}</div>
      <Actions>
        <button className="btn" onClick={() => close(false)}>Cancel</button>
        <button className={`btn ${req?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{req?.confirmLabel ?? 'Confirm'}</button>
      </Actions>
    </Modal>
  );
}

const TOAST_TONE = { info: 'bg-accent', success: 'bg-ok', warning: 'bg-warn', error: 'bg-bad' } as const;

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2, ease: PANEL_EASE }}
            className="panel panel-overlay pointer-events-auto flex items-start gap-3 rounded-panel py-3 pl-3 pr-2 text-sm">
            <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${TOAST_TONE[t.kind]}`} aria-hidden />
            <span className="min-w-0 flex-1 text-ink">{t.message}</span>
            <button className="btn btn-ghost btn-sm btn-icon -my-1" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="close" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Global master-password prompt, opened by useVault().ensureUnlocked(). */
export function VaultPrompt() {
  const { prompt, unlock, closePrompt, status } = useVault();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (prompt) { setPw(''); setErr(''); } }, [prompt]);
  const configured = status?.configured ?? true;
  return (
    <Modal open={!!prompt} onClose={() => closePrompt(false)} title={configured ? 'Unlock the vault' : 'Vault not set up'}
      description={configured ? `It locks itself after ${Math.round((status?.auto_lock_ms ?? 600000) / 60000)} minutes of inactivity.` : undefined}>
      {configured ? (
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try { await unlock(pw); closePrompt(true); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
        }}>
          <label className="label" htmlFor="vault-master">Vault master password</label>
          <input id="vault-master" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus />
          {err && <p className="mt-2 text-sm text-bad" role="alert">{err}</p>}
          <Actions>
            <button type="button" className="btn" onClick={() => closePrompt(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !pw}><Icon name="unlock" />{busy ? 'Unlocking…' : 'Unlock'}</button>
          </Actions>
        </form>
      ) : (
        <div>
          <p className="text-sm text-ink-2">Set up the vault on the Settings page first. It needs its own master password, separate from the app password.</p>
          <Actions><button className="btn" onClick={() => closePrompt(false)}>Close</button></Actions>
        </div>
      )}
    </Modal>
  );
}

/** Rough strength estimate (character classes and length). No hints are shown, only a meter. */
export function strength(pw: string): number {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const uniq = new Set(pw).size;
  const bits = Math.log2(Math.max(pool, 2)) * Math.min(pw.length, uniq * 2);
  return Math.max(0, Math.min(4, Math.floor(bits / 22)));
}
export function StrengthMeter({ value }: { value: string }) {
  const s = strength(value);
  const colors = ['bg-bad', 'bg-bad', 'bg-warn', 'bg-ok', 'bg-ok'];
  const words = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-base ${i < s ? colors[s] : 'bg-surface-track'}`} />)}
      </div>
      <p className="mt-1 text-xs text-ink-2">Strength: {value ? words[s] : 'none'}</p>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <EmptyState title={title} action={action}>{children}</EmptyState>;
}

const STATUS_DOT: Record<string, string> = { online: 'bg-ok', running: 'bg-ok', offline: 'bg-bad', stopped: 'bg-bad', planned: 'bg-unknown/60 ring-1 ring-inset ring-unknown', unknown: 'bg-unknown' };
export function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? 'bg-unknown'}`} title={status} aria-label={status} role="img" />;
}
