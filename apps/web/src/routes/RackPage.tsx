import { useEffect } from 'react';
import { useLab } from '../store/lab';

export function RackPage() {
  const { load, loaded, devices, racks } = useLab();
  useEffect(() => { void load(); }, [load]);
  if (!loaded) return <div className="p-6 text-sm">Loading lab…</div>;
  return <div className="p-6 text-sm" data-testid="rack-summary">{racks.length} rack(s), {devices.length} devices</div>;
}
