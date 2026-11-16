import { create } from 'zustand';
import type { VaultStatus } from '@rackmap/shared';
import { api } from '../lib/api';

interface VaultState {
  status: VaultStatus | null;
  /** Set while a component is waiting on the master password prompt. */
  prompt: { resolve: (ok: boolean) => void } | null;
  refresh: () => Promise<void>;
  lock: () => Promise<void>;
  unlock: (master_password: string) => Promise<void>;
  /** Resolves true once unlocked (prompting if needed), false if the user cancels. */
  ensureUnlocked: () => Promise<boolean>;
  closePrompt: (ok: boolean) => void;
}

export const useVault = create<VaultState>((set, get) => ({
  status: null,
  prompt: null,
  async refresh() {
    set({ status: await api.get<VaultStatus>('/vault/status') });
  },
  async lock() {
    await api.post('/vault/lock');
    await get().refresh();
  },
  async unlock(master_password) {
    await api.post('/vault/unlock', { master_password });
    await get().refresh();
  },
  async ensureUnlocked() {
    await get().refresh();
    if (get().status?.unlocked) return true;
    return new Promise<boolean>((resolve) => set({ prompt: { resolve } }));
  },
  closePrompt(ok) {
    get().prompt?.resolve(ok);
    set({ prompt: null });
  },
}));
