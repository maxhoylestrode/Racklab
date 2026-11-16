import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { useVault } from '../store/vault';
import { toast } from '../store/toast';
import { Logo } from './Logo';
import { Icon } from './Icon';

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
  const label = !status.configured ? 'Vault not set up' : unlocked ? 'Vault unlocked. Click to lock.' : 'Vault locked. Click to unlock.';
  return (
    <button
      className={`btn btn-sm ${unlocked ? 'border-amber-500/60 text-amber-600 dark:text-amber-300' : ''}`}
      title={label}
      aria-label={label}
      onClick={async () => {
        try {
          if (unlocked) { await lock(); toast.info('Vault locked'); }
          else if (await ensureUnlocked()) toast.success('Vault unlocked');
        } catch (e) { toast.error(e); }
      }}
    >
      <Icon name={unlocked ? 'unlock' : 'lock'} size={14} />
      <span className="hidden sm:inline">{unlocked ? 'Unlocked' : status.configured ? 'Locked' : 'No vault'}</span>
    </button>
  );
}

export function Layout() {
  const logout = useAuth((s) => s.logout);
  const { theme, setTheme } = useUi();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="no-print z-30 flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/80 px-3 backdrop-blur dark:border-slate-800 dark:bg-[#0d121c]/90">
        <NavLink to="/" className="mr-2 flex items-center gap-2 font-semibold" aria-label="RackMap home">
          <Logo size={24} /> <span className="hidden md:inline">RackMap</span>
        </NavLink>
        <nav className="flex items-center gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition ${isActive ? 'bg-slate-200 font-medium text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'}`}>
              <Icon name={n.icon} size={15} /> <span className="hidden sm:inline">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <VaultIndicator />
        <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
        <div className="relative">
          <button className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} aria-label="More">
            <Icon name="menu" size={16} />
          </button>
          {menu && (
            <div role="menu" className="card absolute right-0 top-9 z-40 w-44 py-1 text-sm" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
              <NavLink role="menuitem" to="/settings" className="block px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">Settings</NavLink>
              <NavLink role="menuitem" to="/audit" className="block px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">Audit log</NavLink>
              <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => void logout()}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
