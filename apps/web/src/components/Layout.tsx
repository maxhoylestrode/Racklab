import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { useVault } from '../store/vault';
import { toast } from '../store/toast';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { Tooltip } from './primitives';

const NAV = [
  { to: '/', label: 'Rack', icon: 'rack' as const, end: true },
  { to: '/topology', label: 'Topology', icon: 'topology' as const },
  { to: '/docs', label: 'Docs', icon: 'docs' as const },
  { to: '/projects', label: 'Projects', icon: 'projects' as const },
];

export function VaultIndicator() {
  const { status, refresh, lock, ensureUnlocked } = useVault();
  const [, tick] = useState(0);
  useEffect(() => {
    void refresh().catch(() => {});
    const a = setInterval(() => void refresh().catch(() => {}), 30_000);
    const b = setInterval(() => tick((n) => n + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [refresh]);
  if (!status) return null;
  const unlocked = status.configured && status.unlocked;
  // Accessible name starts with the visible text (WCAG 2.5.3 label in name).
  const label = !status.configured ? 'No vault: set one up in Settings' : unlocked ? 'Unlocked vault: click to lock' : 'Locked vault: click to unlock';
  return (
    <Tooltip content={!status.configured ? 'Set up the vault in Settings' : unlocked ? 'Secrets can be revealed. Click to lock now.' : 'Click to unlock'}>
      <button
        className={`btn btn-sm ${unlocked ? 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/15' : 'btn-ghost'}`}
        aria-label={label}
        onClick={async () => {
          try {
            if (unlocked) { await lock(); toast.info('Vault locked'); }
            else if (await ensureUnlocked()) toast.success('Vault unlocked');
          } catch (e) { toast.error(e); }
        }}
      >
        <Icon name={unlocked ? 'unlock' : 'lock'} />
        <span className="hidden sm:inline">{unlocked ? 'Unlocked' : status.configured ? 'Locked' : 'No vault'}</span>
      </button>
    </Tooltip>
  );
}

function MoreMenu() {
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost btn-sm btn-icon" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((m) => !m)} aria-label="More">
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" className="menu absolute right-0 top-9 w-48"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
              const i = items.indexOf(document.activeElement as HTMLElement);
              items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }
          }}>
          <NavLink role="menuitem" to="/settings" className="menu-item"><Icon name="settings" className="text-ink-2" />Settings</NavLink>
          <NavLink role="menuitem" to="/audit" className="menu-item"><Icon name="history" className="text-ink-2" />Audit log</NavLink>
          <div className="menu-sep" role="separator" />
          <button role="menuitem" className="menu-item" onClick={() => void logout()}><Icon name="logout" className="text-ink-2" />Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { theme, setTheme } = useUi();
  return (
    <div className="flex h-screen flex-col gap-2 overflow-hidden p-2">
      <a href="#main" className="sr-only z-toast rounded-control bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to content</a>
      <header className="glass no-print relative z-toolbar flex h-12 shrink-0 items-center gap-2 rounded-panel pl-3 pr-2">
        <NavLink to="/" className="mr-2 flex items-center gap-2 rounded-control text-sm font-medium tracking-tight" aria-label="RackMap home">
          <Logo size={20} /> <span className="hidden md:inline">RackMap</span>
        </NavLink>
        <nav className="flex items-center gap-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}
              className={({ isActive }) => `flex h-8 items-center gap-2 rounded-control px-2 text-sm transition-colors duration-fast sm:px-3 ${isActive ? 'bg-accent/10 font-medium text-accent' : 'text-ink-2 hover:bg-surface-hover hover:text-ink'}`}>
              <Icon name={n.icon} /> <span className="hidden sm:inline">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <VaultIndicator />
        <Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </Tooltip>
        <MoreMenu />
      </header>
      <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 outline-none">
        <Outlet />
      </main>
    </div>
  );
}
