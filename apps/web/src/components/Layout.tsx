import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { useVault } from '../store/vault';
import { useLab } from '../store/lab';
import { QUICK_ADD_EVENT, useChrome } from '../store/chrome';
import { toast } from '../store/toast';
import { Logo } from './Logo';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './primitives';
import { isShelf } from '../lib/inventory';

interface NavItem { to: string; label: string; icon: IconName; end?: boolean; count?: (s: ReturnType<typeof useLab.getState>) => number | null }

/** Sidebar order (DESK, then CONTROLS). Inventory is home. */
export const DESK: NavItem[] = [
  { to: '/', label: 'Inventory', icon: 'list', end: true, count: (s) => (s.loaded ? s.devices.filter((d) => !isShelf(d, s.templates)).length : null) },
  { to: '/rack', label: 'Rack', icon: 'rack' },
  { to: '/topology', label: 'Topology', icon: 'topology' },
  { to: '/projects', label: 'Projects', icon: 'projects' },
  { to: '/docs', label: 'Docs', icon: 'docs' },
];
export const CONTROLS: NavItem[] = [
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/audit', label: 'Audit log', icon: 'history' },
];
const TITLES: Record<string, string> = Object.fromEntries([...DESK, ...CONTROLS].map((n) => [n.to, n.label]));

function NavGroup({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate?: () => void }) {
  const lab = useLab();
  return (
    <div>
      <h2 className="eyebrow px-3 pb-1 pt-4">{title}</h2>
      <ul className="space-y-px">
        {items.map((n) => {
          const count = n.count?.(lab);
          return (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} onClick={onNavigate}
                className={({ isActive }) => `flex h-8 items-center gap-2 rounded-sm px-3 text-sm transition-colors duration-fast ${isActive ? 'bg-surface-raised font-medium text-ink shadow-[0_0_0_1px_var(--hairline)]' : 'text-ink-2 hover:bg-surface-hover hover:text-ink'}`}>
                <Icon name={n.icon} />
                <span className="flex-1">{n.label}</span>
                {count != null && <span className="font-mono text-xs text-ink-2">{count}</span>}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Inverted card at the bottom of the sidebar: live vault state, lock or unlock in one click. */
function VaultCard() {
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
  const mins = Math.max(0, Math.ceil(status.remaining_ms / 60000));
  const label = !status.configured ? 'No vault: set one up in Settings' : unlocked ? 'Unlocked vault: click to lock' : 'Locked vault: click to unlock';
  return (
    <div className="rounded-control bg-[#141414] p-3 text-[#f2f2ee] dark:bg-[#f2f2ee] dark:text-[#141414]">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-white/10 dark:bg-black/10"><Icon name={unlocked ? 'unlock' : 'lock'} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{!status.configured ? 'No vault' : unlocked ? 'Vault unlocked' : 'Vault locked'}</p>
          <p className="truncate text-xs opacity-80">{!status.configured ? 'Set it up in Settings' : unlocked ? `Locks in ${mins} min` : 'Secrets are encrypted'}</p>
        </div>
      </div>
      {status.configured && (
        <button aria-label={label}
          className="mt-3 flex h-7 w-full items-center justify-center gap-1 rounded-full bg-white/10 text-xs font-medium transition-colors duration-fast hover:bg-white/20 dark:bg-black/10 dark:hover:bg-black/20"
          onClick={async () => {
            try {
              if (unlocked) { await lock(); toast.info('Vault locked'); }
              else if (await ensureUnlocked()) toast.success('Vault unlocked');
            } catch (e) { toast.error(e); }
          }}>
          {unlocked ? 'Lock now' : 'Unlock'}
        </button>
      )}
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const logout = useAuth((s) => s.logout);
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-2 px-3 py-4">
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line-strong bg-[#141414]"><Logo size={20} /></span>
        <div className="min-w-0">
          <p className="text-md font-medium leading-5 text-ink">RackMap</p>
          <p className="text-xs text-ink-2">Home lab</p>
        </div>
      </div>
      <NavGroup title="Desk" items={DESK} onNavigate={onNavigate} />
      <NavGroup title="Controls" items={CONTROLS} onNavigate={onNavigate} />
      <div className="flex-1" />
      <VaultCard />
      <div className="flex items-center gap-2 rounded-control border border-line bg-panel px-2 py-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-xs font-medium text-ink" aria-hidden>A</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">Admin</p>
          <p className="truncate text-xs text-ink-2">Single user</p>
        </div>
        <Tooltip content="Sign out" side="top">
          <button className="btn btn-ghost btn-sm" aria-label="Sign out" onClick={() => void logout()}><Icon name="logout" /></button>
        </Tooltip>
      </div>
    </nav>
  );
}

/** "7 of 8 online" from real device statuses (planned devices are not expected online). */
function StatusPill() {
  const { devices, templates, loaded } = useLab();
  if (!loaded || !devices.length) return null;
  // Shelves are furniture: they are neither online nor offline.
  const live = devices.filter((d) => d.status !== 'planned' && !isShelf(d, templates));
  const online = live.filter((d) => d.status === 'online').length;
  const all = online === live.length;
  return (
    <span className="hidden h-7 items-center gap-2 rounded-full border border-line-strong bg-panel px-3 text-xs font-medium text-ink-2 sm:inline-flex" role="status">
      <span className={`h-2 w-2 rounded-full ${all ? 'bg-ok' : 'bg-warn'}`} aria-hidden />
      {online} of {live.length} online
    </span>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { theme, themePref, setTheme } = useUi();
  const loc = useLocation();
  const navigate = useNavigate();
  const action = useChrome((s) => s.action);
  const section = '/' + (loc.pathname.split('/')[1] ?? '');
  const title = TITLES[section] ?? 'Inventory';
  const group = CONTROLS.some((c) => c.to === section) ? 'Controls' : 'Desk';
  const primary = action ?? { label: 'New device', run: () => { if (loc.pathname !== '/') navigate('/'); setTimeout(() => window.dispatchEvent(new Event(QUICK_ADD_EVENT)), 60); } };
  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-2 px-2 sm:px-4 md:px-6">
      <button className="btn btn-ghost btn-sm lg:hidden" aria-label="Open navigation" onClick={onMenu}><Icon name="menu" /></button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1 truncate text-sm text-ink-2">
          <li className="hidden sm:block">RackMap</li>
          <li className="hidden sm:block" aria-hidden><Icon name="chevronRight" className="text-ink-3" /></li>
          <li className="hidden sm:block">{group}</li>
          <li className="hidden sm:block" aria-hidden><Icon name="chevronRight" className="text-ink-3" /></li>
          <li className="truncate font-medium text-ink" aria-current="page">{title}</li>
        </ol>
      </nav>
      <StatusPill />
      <Tooltip content={themePref === 'system' ? `Following the system (${theme})` : 'Theme set manually'}>
        <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </Tooltip>
      {themePref !== 'system' && (
        <Tooltip content="Follow the system theme">
          <button className="btn btn-ghost btn-sm hidden sm:inline-flex" onClick={() => setTheme('system')} aria-label="Follow the system theme"><Icon name="dim" /></button>
        </Tooltip>
      )}
      <button className="btn btn-primary btn-sm" onClick={primary.run}><Icon name="plus" /><span className="max-sm:sr-only">{primary.label}</span></button>
    </header>
  );
}

export function Layout() {
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const panel = useRef<HTMLDivElement>(null);
  const { loaded, load } = useLab();
  useEffect(() => { if (!loaded) void load().catch(toast.error); }, [loaded, load]);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [menu]);
  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#main" className="sr-only z-toast rounded-full bg-accent px-4 py-2 text-accent-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to content</a>
      <aside className="no-print hidden w-[var(--sidebar-w)] shrink-0 lg:block">
        <Sidebar />
      </aside>
      {menu && (
        <div className="fixed inset-0 z-dialog lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenu(false)} />
          <div ref={panel} className="panel panel-overlay absolute inset-y-2 left-2 w-[260px] overflow-y-auto rounded-panel">
            <Sidebar onNavigate={() => setMenu(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMenu(true)} />
        <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 px-2 pb-2 outline-none sm:px-4 sm:pb-4 md:px-6 md:pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
