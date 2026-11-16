import type { SceneApi } from '../rack/RackScene';

export function useWiring() {
  return { pending: null as string | null, cancel: () => {} };
}

export function Cables(_props: { scene: SceneApi; dimmed: (id: string) => boolean }) {
  return null;
}
