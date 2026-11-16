import { create } from 'zustand';
import { errorMessage } from '../lib/api';

export interface Toast { id: number; kind: 'info' | 'error' | 'warning' | 'success'; message: string }

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast['kind'], message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, message) {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (m: string) => useToast.getState().push('info', m),
  success: (m: string) => useToast.getState().push('success', m),
  warn: (m: string) => useToast.getState().push('warning', m),
  error: (e: unknown) => useToast.getState().push('error', errorMessage(e)),
};
