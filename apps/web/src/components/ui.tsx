import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '../store/toast';
import { useVault } from '../store/vault';
import { errorMessage } from '../lib/api';

export function Modal({ open, onClose, title, children, width = 'max-w-md', labelledBy }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string; labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button');
      el?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  const titleId = labelledBy ?? `modal-${title.replace(/\W+/g, '-')}`;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={`card w-full ${width} max-h-[90vh] overflow-y-auto p-5`}
            initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.15 }}>
            <h2 id={titleId} className="mb-4 text-base font-semibold">{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

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
      <div className="mb-5 text-sm text-slate-600 dark:text-slate-300">{req?.message}</div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={() => close(false)}>Cancel</button>
        <button className={`btn ${req?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{req?.confirmLabel ?? 'Confirm'}</button>
      </div>
    </Modal>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const color = { info: 'border-sky-500', success: 'border-emerald-500', warning: 'border-amber-500', error: 'border-rose-500' };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
            className={`card pointer-events-auto border-l-4 ${color[t.kind]} px-3 py-2 text-sm`}>
            <div className="flex items-start gap-2">
              <span className="flex-1">{t.message}</span>
              <button className="text-slate-400 hover:text-slate-200" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
            </div>
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
    <Modal open={!!prompt} onClose={() => closePrompt(false)} title={configured ? 'Unlock the vault' : 'Vault not set up'}>
      {configured ? (
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try { await unlock(pw); closePrompt(true); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
        }}>
          <label className="label" htmlFor="vault-master">Vault master password</label>
          <input id="vault-master" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus />
          {err && <p className="mt-2 text-sm text-rose-500" role="alert">{err}</p>}
          <p className="mt-3 text-xs text-slate-500">The vault locks itself after {Math.round((status?.auto_lock_ms ?? 600000) / 60000)} minutes of inactivity.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => closePrompt(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !pw}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          </div>
        </form>
      ) : (
        <div>
          <p className="text-sm">Set up the vault on the Settings page first. It needs its own master password, separate from the app password.</p>
          <div className="mt-4 flex justify-end"><button className="btn" onClick={() => closePrompt(false)}>Close</button></div>
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
  const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'];
  const words = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-1.5 flex-1 rounded ${i < s ? colors[s] : 'bg-slate-300 dark:bg-slate-700'}`} />)}
      </div>
      <p className="mt-1 text-xs text-slate-500">Strength: {value ? words[s] : 'none'}</p>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const c: Record<string, string> = { online: 'bg-emerald-500', running: 'bg-emerald-500', offline: 'bg-rose-500', stopped: 'bg-rose-500', planned: 'bg-sky-500', unknown: 'bg-slate-400' };
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c[status] ?? 'bg-slate-400'}`} title={status} aria-label={status} />;
}
