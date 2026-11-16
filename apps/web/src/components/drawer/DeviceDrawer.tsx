import { useLab } from '../../store/lab';

export function DeviceDrawer() {
  const { selection, devices } = useLab();
  const d = selection?.kind === 'device' ? devices.find((x) => x.id === selection.id) : undefined;
  if (!d) return null;
  return <aside className="w-80 shrink-0 border-l border-slate-200 p-4 dark:border-slate-800" aria-label="Device details"><h2 className="font-semibold">{d.name}</h2><p className="text-sm text-slate-500">{d.status}</p></aside>;
}
