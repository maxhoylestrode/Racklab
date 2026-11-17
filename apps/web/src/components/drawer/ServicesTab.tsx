import { useEffect, useState } from 'react';
import { useUi } from '../../store/ui';
import { SERVICE_KINDS, SERVICE_STATUSES, type Device, type IpAddress, type Service, type ServiceKind, type ServiceNode, type ServiceStatus } from '@rackmap/shared';
import { useFetch } from '../../lib/useFetch';
import { api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Modal, StatusDot, confirmDialog } from '../ui';
import { Icon } from '../Icon';

export const KIND_LABEL: Record<ServiceKind, string> = { vm: 'VM', lxc: 'CT', docker: 'Docker', app: 'App', other: 'Other' };

/** Tree of VMs, containers and apps hosted on a device. Drag a row onto another to reparent; drop on the root zone to un-nest. */
export function ServicesTab({ device }: { device: Device }) {
  const tree = useFetch<ServiceNode[]>(`/devices/${device.id}/services`, [device.id]);
  const ips = useFetch<IpAddress[]>(`/ip-addresses?device_id=${device.id}`, [device.id]);
  const [editing, setEditing] = useState<{ svc: Service | null; parent: string | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const focus = useUi((s) => s.focusService);
  // Highlight the service the inventory asked for, scroll to it, then let the highlight go.
  useEffect(() => {
    if (!focus || !tree.data) return;
    requestAnimationFrame(() => document.querySelector(`[data-service="${focus}"]`)?.scrollIntoView({ block: 'nearest' }));
    const t = setTimeout(() => useUi.getState().setFocusService(null), 2500);
    return () => clearTimeout(t);
  }, [focus, tree.data]);

  const reparent = async (id: string, parent: string | null) => {
    try {
      await api.patch(`/services/${id}`, { parent_service_id: parent });
      void tree.reload();
    } catch (e) { toast.error(e); }
  };

  const Row = ({ n, depth }: { n: ServiceNode; depth: number }) => (
    <li>
      <div
        draggable
        onDragStart={(e) => { setDragId(n.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); }}
        onDragEnd={() => { setDragId(null); setOver(null); }}
        onDragOver={(e) => { if (dragId && dragId !== n.id) { e.preventDefault(); setOver(n.id); } }}
        onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
        onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId && dragId !== n.id) void reparent(dragId, n.id); }}
        data-service={n.id}
        className={`group flex h-9 items-center gap-2 rounded-control border px-2 text-sm transition-colors duration-fast ${over === n.id ? 'border-dashed border-accent bg-accent/10' : focus === n.id ? 'border-transparent bg-tint text-tint-ink' : 'border-transparent hover:bg-surface-hover'}`}
        style={{ marginLeft: depth * 16 }}
      >
        <Icon name="grip" size={12} className="cursor-grab text-ink-3" />
        <StatusDot status={n.status} />
        <span className="chip w-[68px] shrink-0 justify-between font-mono">{KIND_LABEL[n.kind]}{n.vmid_or_ctid != null && <span className="text-ink">{n.vmid_or_ctid}</span>}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{n.name}</span>
        {n.url && <a href={n.url} target="_blank" rel="noopener noreferrer" className="rounded-control p-1 text-ink-2 hover:bg-surface-hover hover:text-accent" aria-label={`Open ${n.name}`} onClick={(e) => e.stopPropagation()}><Icon name="external" size={12} /></a>}
        <span className="hidden gap-1 group-hover:flex group-focus-within:flex">
          <button className="btn btn-ghost btn-sm" aria-label={`Add inside ${n.name}`} title="Add child" onClick={() => setEditing({ svc: null, parent: n.id })}><Icon name="plus" size={11} /></button>
          <button className="btn btn-ghost btn-sm" aria-label={`Edit ${n.name}`} onClick={() => setEditing({ svc: n, parent: n.parent_service_id })}><Icon name="edit" size={11} /></button>
          {n.parent_service_id && <button className="btn btn-ghost btn-sm" aria-label={`Move ${n.name} to top level`} title="Move to top level" onClick={() => void reparent(n.id, null)}><Icon name="undo" size={11} /></button>}
        </span>
      </div>
      {(n.port_number || n.ip_address_id) && (
        <div className="pb-1 font-mono text-xs text-ink-2" style={{ marginLeft: depth * 16 + 40 }}>
          {ips.data?.find((i) => i.id === n.ip_address_id)?.address}{n.port_number ? `:${n.port_number}` : ''}
        </div>
      )}
      {n.children.length > 0 && <ul>{n.children.map((c) => <Row key={c.id} n={c} depth={depth + 1} />)}</ul>}
    </li>
  );

  return (
    <div>
      <div className="mb-2 flex h-8 items-center justify-between">
        <h3 className="text-sm font-medium">Services</h3>
        <button className="btn btn-sm" onClick={() => setEditing({ svc: null, parent: null })}><Icon name="plus" size={12} /> Add service</button>
      </div>
      {!tree.data?.length ? (
        <p className="text-sm text-ink-2">Nothing hosted here yet. Add VMs, LXC containers, Docker apps or plain apps, for example a Proxmox host with CT 100 and VM 200.</p>
      ) : (
        <>
          <ul className="-mx-2">{tree.data.map((n) => <Row key={n.id} n={n} depth={0} />)}</ul>
          {dragId && (
            <div className="mt-2 rounded-control border border-dashed border-accent/50 px-3 py-2 text-xs text-ink-2"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void reparent(dragId, null); }}>
              Drop here to move to the top level
            </div>
          )}
          <p className="mt-2 text-xs text-ink-2">Drag a service onto another to nest it.</p>
        </>
      )}
      {editing && (
        <ServiceDialog device={device} svc={editing.svc} parent={editing.parent} ips={ips.data ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void tree.reload(); }} />
      )}
    </div>
  );
}

function ServiceDialog({ device, svc, parent, ips, onClose, onSaved }: {
  device: Device; svc: Service | null; parent: string | null; ips: IpAddress[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: svc?.name ?? '', kind: (svc?.kind ?? 'lxc') as ServiceKind, vmid_or_ctid: svc?.vmid_or_ctid?.toString() ?? '',
    ip_address_id: svc?.ip_address_id ?? '', port_number: svc?.port_number?.toString() ?? '', url: svc?.url ?? '',
    status: (svc?.status ?? 'running') as ServiceStatus, notes: svc?.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} title={svc ? `Edit ${svc.name}` : 'Add service'}>
      <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = {
          device_id: device.id, parent_service_id: parent, name: f.name, kind: f.kind, status: f.status,
          vmid_or_ctid: f.vmid_or_ctid ? Number(f.vmid_or_ctid) : null, ip_address_id: f.ip_address_id || null,
          port_number: f.port_number ? Number(f.port_number) : null, url: f.url || null, notes: f.notes || null,
        };
        try {
          if (svc) await api.patch(`/services/${svc.id}`, body); else await api.post('/services', body);
          onSaved();
        } catch (err) { toast.error(err); }
      }}>
        <label className="col-span-2"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></label>
        <label><span className="label">Kind</span><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{SERVICE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <label><span className="label">VMID / CTID</span><input type="number" className="input" value={f.vmid_or_ctid} onChange={(e) => set('vmid_or_ctid', e.target.value)} /></label>
        <label><span className="label">IP</span>
          <select className="input" value={f.ip_address_id} onChange={(e) => set('ip_address_id', e.target.value)}>
            <option value="">None</option>{ips.map((i) => <option key={i.id} value={i.id}>{i.address}</option>)}
          </select>
        </label>
        <label><span className="label">Port</span><input type="number" min={1} max={65535} className="input" value={f.port_number} onChange={(e) => set('port_number', e.target.value)} /></label>
        <label className="col-span-2"><span className="label">URL</span><input type="url" className="input" placeholder="https://" value={f.url} onChange={(e) => set('url', e.target.value)} /></label>
        <label><span className="label">Status</span><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{SERVICE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="col-span-2"><span className="label">Notes</span><textarea className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div className="col-span-2 mt-2 flex justify-between">
          {svc ? <button type="button" className="btn btn-danger" onClick={async () => {
            if (!(await confirmDialog({ title: `Delete ${svc.name}?`, message: 'Child services, notes and credentials under it are deleted too.', danger: true, confirmLabel: 'Delete' }))) return;
            try { await api.del(`/services/${svc.id}`); onSaved(); } catch (err) { toast.error(err); }
          }}>Delete</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save service</button></div>
        </div>
      </form>
    </Modal>
  );
}
