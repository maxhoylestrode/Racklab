import { useEffect } from 'react';
import { create } from 'zustand';

/** Page-level chrome: the top bar's primary action. Pages register theirs while mounted. */
export interface PrimaryAction { label: string; run: () => void }

interface ChromeState {
  action: PrimaryAction | null;
  set: (a: PrimaryAction | null) => void;
}

export const useChrome = create<ChromeState>((set) => ({ action: null, set: (action) => set({ action }) }));

export function usePrimaryAction(label: string, run: () => void) {
  useEffect(() => {
    useChrome.getState().set({ label, run });
    return () => useChrome.getState().set(null);
  }, [label, run]);
}

/** Fired by the default "New device" action; the Inventory page focuses its quick-add row. */
export const QUICK_ADD_EVENT = 'rackmap:quick-add';
