import { create } from 'zustand';
import { api } from '../lib/api';

type Phase = 'loading' | 'setup' | 'login' | 'ready';

interface AuthState {
  phase: Phase;
  init: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  expired: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  phase: 'loading',
  async init() {
    const { setup_required } = await api.get<{ setup_required: boolean }>('/auth/status');
    if (setup_required) return set({ phase: 'setup' });
    try {
      await api.get('/auth/me');
      set({ phase: 'ready' });
    } catch {
      set({ phase: 'login' });
    }
  },
  async setup(password) {
    await api.post('/auth/setup', { password });
    set({ phase: 'ready' });
  },
  async login(password) {
    await api.post('/auth/login', { password });
    set({ phase: 'ready' });
  },
  async logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      set({ phase: 'login' });
    }
  },
  expired() {
    set((s) => (s.phase === 'ready' ? { phase: 'login' } : s));
  },
}));
