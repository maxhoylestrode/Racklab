import { useMemo, useState } from 'react';
import { IP_KINDS, type Device, type IpAddress, type IpKind, type Vlan } from '@rackmap/shared';
import { useLab } from '../../store/lab';
import { useFetch } from '../../lib/useFetch';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Modal, confirmDialog } from '../ui';
import { Icon } from '../Icon';

export function NetworkTab({ device }: { device: Device }) {
  const { devices, links, select } = useLab();
  const ips = useFetch<IpAddress[]>(`/ip-addresses?device_id=${device.id}`, [device.id]);
  const vlans = useFetch<Vlan[]>('/vlans');
  const [editing, setEditing] = useState<IpAddress | 'new' | null>(null);

  const peers = useMemo(() => {
    const owner = new Map(devices.flatMap((d) => d.ports.map((p) => [p.id, { d, p }] as const)));
    const m = new Map<string, { d: Device; label: string; speed: number | null }>();
    for (const l of links) {
      const a = owner.get(l.port_a_id), b = owner.get(l.port_b_id);
      if (!a || !b) continue;
      m.set(a.p.id, { d: b.d, label: b.p.label, speed: b.p.speed_mbps });
      m.set(b.p.id, { d: a.d, label: a.p.label, speed: a.p.speed_mbps });
    }
    return m;
  }, [devices, links]);

  return (
    <div className="space-y-5">
      <section aria-labelledby="ports-h">
        <h3 id="ports-h" className="mb-2 text-sm font-semibold">Ports</h3>
        {!device.ports.length ? <p className="text-xs text-slate-500">This device has no ports.</p> : (
          <table className="table-base">
            <thead><tr><th>Port</th><th>Kind</th><th>Link</th><th>Connects to</th></tr></thead>
            <tbody>
              {device.ports.map((p) => {
                const peer = peers.get(p.id);
                const mismatch = peer && p.speed_mbps && peer.speed && p.speed_mbps !== peer.speed;
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.label}</td>
                    <td className="text-xs text-slate-500">{p.kind}{p.speed_mbps ? ` ${p.speed_mbps >= 1000 ? `${p.speed_mbps / 1000}G` : `${p.speed_mbps}M`}` : ''}{p.poe ? ' PoE' : ''}</td>
                    <td>{peer ? <span className="chip border-emerald-500/40 text-emerald-600 dark:text-emerald-400">up</span> : <span className="chip">free</span>}</td>
                    <td className="text-xs">
                      {peer ? (
                        <button className="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400" onClick={() => select({ kind: 'device', id: peer.d.id })}>
                          {peer.d.name} · {peer.label}
                        </button>
                      ) : '—'}
                      {mismatch && <span className="ml-1 text-amber-500" title="Speed mismatch"><Icon name="warning" size={11} className="inline" /></span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="ips-h">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="ips-h" className="text-sm font-semibold">IP addresses</h3>
          <button className="btn btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={12} /> Add IP</button>
        </div>
        {!ips.data?.length ? <p className="text-xs text-slate-500">No IP addresses yet. Add the real values for this device.</p> : (
          <table className="table-base">
            <thead><tr><th>Address</th><th>Kind</th><th>VLAN</th><th /></tr></thead>
            <tbody>
              {ips.data.map((ip) => (
                <tr key={ip.id}>
                  <td>
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      {ip.is_primary && <span title="Primary IP" className="text-amber-500">★</span>}
                      {ip.address}/{ip.prefix_length}
                      {ip.warnings.map((w) => (
                        <span key={w.code} className="chip border-amber-500/50 text-amber-600 dark:text-amber-300" title={w.message}>
                          <Icon name="warning" size={10} /> {w.code === 'duplicate_ip' ? 'duplicate' : 'outside VLAN'}
                        </span>
                      ))}
                    </div>
                    {ip.dns_name && <div className="text-[11px] text-slate-500">{ip.dns_name}</div>}
                  </td>
                  <td className="text-xs">{ip.kind}</td>
                  <td className="text-xs">{ip.vlan_number ?? '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn btn-ghost btn-sm" aria-label={`Edit ${ip.address}`} onClick={() => setEditing(ip)}><Icon name="edit" size={12} /></button>
                    <button className="btn btn-ghost btn-sm" aria-label={`Delete ${ip.address}`} onClick={async () => {
                      if (!(await confirmDialog({ title: 'Delete IP?', message: `Delete ${ip.address}?`, danger: true, confirmLabel: 'Delete' }))) return;
                      try { await api.del(`/ip-addresses/${ip.id}`); void ips.reload(); } catch (e) { toast.error(e); }
                    }}><Icon name="trash" size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editing && (
        <IpDialog device={device} ip={editing === 'new' ? null : editing} vlans={vlans.data ?? []} onVlanCreated={() => void vlans.reload()}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void ips.reload(); }} />
      )}
    </div>
  );
}

function IpDialog({ device, ip, vlans, onClose, onSaved, onVlanCreated }: {
  device: Device; ip: IpAddress | null; vlans: Vlan[]; onClose: () => void; onSaved: () => void; onVlanCreated: () => void;
}) {
  const [f, setF] = useState({
    address: ip?.address ?? '', prefix_length: ip?.prefix_length ?? 24, kind: (ip?.kind ?? 'static') as IpKind, vlan_id: ip?.vlan_id ?? '',
    port_id: ip?.port_id ?? '', dns_name: ip?.dns_name ?? '', is_primary: ip?.is_primary ?? false, notes: ip?.notes ?? '',
  });
  const [newVlan, setNewVlan] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, device_id: device.id, vlan_id: f.vlan_id || null, port_id: f.port_id || null, dns_name: f.dns_name || null, notes: f.notes || null };
    try {
      const saved = ip ? await api.patch<IpAddress>(`/ip-addresses/${ip.id}`, body) : await api.post<IpAddress>('/ip-addresses', body);
      for (const w of saved?.warnings ?? []) toast.warn(w.message);
      onSaved();
    } catch (err) { toast.error(err); }
  };
  return (
    <Modal open onClose={onClose} title={ip ? `Edit ${ip.address}` : 'Add IP address'}>
      <form onSubmit={submit} className="grid grid-cols-3 gap-3">
        <label className="col-span-2"><span className="label">Address</span><input className="input font-mono" value={f.address} onChange={(e) => set('address', e.target.value.trim())} placeholder="192.168.1.10" autoFocus required /></label>
        <label><span className="label">Prefix</span><input type="number" min={0} max={128} className="input" value={f.prefix_length} onChange={(e) => set('prefix_length', Number(e.target.value))} /></label>
        <label><span className="label">Kind</span><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{IP_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="col-span-2"><span className="label">VLAN</span>
          <div className="flex gap-1">
            <select className="input" value={f.vlan_id} onChange={(e) => set('vlan_id', e.target.value)}>
              <option value="">None</option>
              {vlans.map((v) => <option key={v.id} value={v.id}>{v.vlan_number} · {v.name}{v.subnet ? ` (${v.subnet})` : ''}</option>)}
            </select>
            <button type="button" className="btn btn-sm" onClick={() => setNewVlan(true)} aria-label="New VLAN"><Icon name="plus" size={12} /></button>
          </div>
        </label>
        <label className="col-span-3"><span className="label">Port</span>
          <select className="input" value={f.port_id} onChange={(e) => set('port_id', e.target.value)}>
            <option value="">Not tied to a port</option>
            {device.ports.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="col-span-3"><span className="label">DNS name</span><input className="input" value={f.dns_name} onChange={(e) => set('dns_name', e.target.value)} /></label>
        <label className="col-span-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_primary} onChange={(e) => set('is_primary', e.target.checked)} /> Primary IP for this device</label>
        <label className="col-span-3"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div className="col-span-3 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save</button></div>
      </form>
      {newVlan && <VlanDialog onClose={() => setNewVlan(false)} onSaved={(v) => { setNewVlan(false); onVlanCreated(); set('vlan_id', v.id); }} />}
    </Modal>
  );
}

export function VlanDialog({ vlan, onClose, onSaved }: { vlan?: Vlan; onClose: () => void; onSaved: (v: Vlan) => void }) {
  const [n, setN] = useState(vlan?.vlan_number ?? 10);
  const [name, setName] = useState(vlan?.name ?? '');
  const [subnet, setSubnet] = useState(vlan?.subnet ?? '');
  return (
    <Modal open onClose={onClose} title={vlan ? `Edit VLAN ${vlan.vlan_number}` : 'New VLAN'}>
      <form className="grid grid-cols-3 gap-3" onSubmit={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const body = { vlan_number: n, name, subnet: subnet || null };
          onSaved(vlan ? await api.patch<Vlan>(`/vlans/${vlan.id}`, body) : await api.post<Vlan>('/vlans', body));
        } catch (err) { toast.error(err); }
      }}>
        <label><span className="label">Number</span><input type="number" min={1} max={4094} className="input" value={n} onChange={(e) => setN(Number(e.target.value))} /></label>
        <label className="col-span-2"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
        <label className="col-span-3"><span className="label">Subnet</span><input className="input font-mono" placeholder="192.168.10.0/24" value={subnet} onChange={(e) => setSubnet(e.target.value.trim())} /></label>
        <div className="col-span-3 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save VLAN</button></div>
      </form>
    </Modal>
  );
}
