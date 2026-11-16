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
export type ProjectsView = 'board' | 'list';

interface UiState {
  theme: Theme;
  unitPx: number;
  wireMode: boolean;
  showCables: boolean;
  dimUnrelated: boolean;
  showBadges: boolean;
  projectsView: ProjectsView;
  reducedMotion: 'system' | 'reduce' | 'no-preference';
  search: string;
  setTheme: (t: Theme) => void;
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
  theme: load<Theme>('theme', 'dark'),
  unitPx: load('unitPx', 44),
  wireMode: false,
  showCables: load('showCables', true),
  dimUnrelated: load('dimUnrelated', false),
  showBadges: load('showBadges', true),
  projectsView: load<ProjectsView>('projectsView', 'board'),
  reducedMotion: load('reducedMotion', 'system'),
  search: '',
  setTheme: (theme) => { save('theme', theme); applyTheme(theme); set({ theme }); },
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

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.documentElement.dataset.theme = t;
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
