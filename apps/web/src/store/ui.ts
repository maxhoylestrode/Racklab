import { create } from 'zustand';

/** Per-browser view preferences. localStorage access is wrapped so private windows still work. */
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`rackmap.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(`rackmap.${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export type Theme = 'dark' | 'light';
/** The stored preference: an explicit theme, or follow the operating system. */
export type ThemePref = Theme | 'system';
export type ProjectsView = 'board' | 'list';

interface UiState {
  /** The theme in effect. */
  theme: Theme;
  themePref: ThemePref;
  unitPx: number;
  wireMode: boolean;
  showCables: boolean;
  dimUnrelated: boolean;
  showBadges: boolean;
  projectsView: ProjectsView;
  reducedMotion: 'system' | 'reduce' | 'no-preference';
  search: string;
  /** One-shot request to scroll a device into view in another view (Show in rack / Show in inventory). */
  reveal: { view: 'rack' | 'inventory'; id: string } | null;
  setReveal: (r: UiState['reveal']) => void;
  setTheme: (t: ThemePref) => void;
  setUnitPx: (px: number) => void;
  setWireMode: (v: boolean) => void;
  toggle: (k: 'showCables' | 'dimUnrelated' | 'showBadges') => void;
  setProjectsView: (v: ProjectsView) => void;
  setReducedMotion: (v: UiState['reducedMotion']) => void;
  setSearch: (s: string) => void;
}

export const UNIT_MIN = 28;
export const UNIT_MAX = 80;

export const useUi = create<UiState>((set) => ({
  themePref: load<ThemePref>('themePref', 'system'),
  theme: resolveTheme(load<ThemePref>('themePref', 'system')),
  unitPx: load('unitPx', 44),
  wireMode: false,
  showCables: load('showCables', true),
  dimUnrelated: load('dimUnrelated', false),
  showBadges: load('showBadges', true),
  projectsView: load<ProjectsView>('projectsView', 'board'),
  reducedMotion: load('reducedMotion', 'system'),
  search: '',
  reveal: null,
  setReveal: (reveal) => set({ reveal }),
  setTheme: (themePref) => { save('themePref', themePref); const theme = resolveTheme(themePref); applyTheme(theme); set({ theme, themePref }); },
  setUnitPx: (px) => {
    const unitPx = Math.round(Math.min(UNIT_MAX, Math.max(UNIT_MIN, px)));
    save('unitPx', unitPx);
    set({ unitPx });
  },
  setWireMode: (wireMode) => set({ wireMode }),
  toggle: (k) => set((s) => { save(k, !s[k]); return { [k]: !s[k] } as Partial<UiState>; }),
  setProjectsView: (projectsView) => { save('projectsView', projectsView); set({ projectsView }); },
  setReducedMotion: (reducedMotion) => { save('reducedMotion', reducedMotion); applyMotion(reducedMotion); set({ reducedMotion }); },
  setSearch: (search) => set({ search }),
}));

export function systemTheme(): Theme {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function resolveTheme(p: ThemePref): Theme { return p === 'system' ? systemTheme() : p; }
export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.documentElement.dataset.theme = t;
}
/** Keeps the theme in step with the OS while the preference is 'system'. */
export function watchSystemTheme() {
  if (typeof matchMedia === 'undefined') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useUi.getState().themePref !== 'system') return;
    const theme = systemTheme();
    applyTheme(theme);
    useUi.setState({ theme });
  });
}
export function applyMotion(m: UiState['reducedMotion']) {
  if (m === 'system') delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = m;
}

/** True when animations should be suppressed (user override or OS preference). */
export function prefersReducedMotion(): boolean {
  const m = useUi.getState().reducedMotion;
  if (m !== 'system') return m === 'reduce';
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
