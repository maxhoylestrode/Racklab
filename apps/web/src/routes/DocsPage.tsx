import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEVICE_STATUSES, type IpAddress, type Note, type Project, type Service, type Vlan } from '@rackmap/shared';
import { useLab } from '../store/lab';
import { toast } from '../store/toast';
import { useFetch } from '../lib/useFetch';
import { api } from '../lib/api';
import { NotesPanel } from '../components/drawer/NotesPanel';
import { VlanDialog } from '../components/drawer/NetworkTab';
import { ProjectDrawer, STATUS_LABEL } from '../components/projects/ProjectDrawer';
import { StatusDot, confirmDialog } from '../components/ui';
import { Icon } from '../components/Icon';

const SECTIONS = ['Search', 'IP plan', 'Inventory', 'Notes', 'VLANs'] as const;
type Section = (typeof SECTIONS)[number];

/** Sort key for IP addresses: IPv4 numerically, IPv6 after. */
export function ipKey(a: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  return m ? ((+m[1] * 256 + +m[2]) * 256 + +m[3]) * 256 + +m[4] : 2 ** 33;
}

export default function DocsPage() {
  const [section, setSection] = useState<Section>('Search');
  const { loaded, load } = useLab();
  useEffect(() => { if (!loaded) void load().catch(toast.error); }, [loaded, load]);
  return (
    <div className="flex h-full flex-col">
      <div className="no-print flex gap-1 border-b border-slate-200 px-3 dark:border-slate-800" role="tablist" aria-label="Docs sections">
        {SECTIONS.map((s) => (
          <button key={s} role="tab" aria-selected={section === s} onClick={() => setSection(s)}
            className={`border-b-2 px-3 py-2.5 text-sm ${section === s ? 'border-sky-500 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-6">
          {section === 'Search' && <GlobalSearch />}
          {section === 'IP plan' && <IpPlan />}
          {section === 'Inventory' && <Inventory />}
          {section === 'Notes' && (
            <div>
              <h1 className="mb-1 text-lg font-semibold">Global notes</h1>
              <p className="mb-4 text-sm text-slate-500">Lab-wide notes such as ISP details and port forwarding rules.</p>
              <NotesPanel scope={{ global: true }} />
            </div>
          )}
          {section === 'VLANs' && <Vlans />}
        </div>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const { devices, select } = useLab();
  const [q, setQ] = useState('');
  const ips = useFetch<IpAddress[]>('/ip-addresses');
  const services = useFetch<Service[]>('/services');
  const notes = useFetch<Note[]>('/notes');
  const projects = useFetch<Project[]>('/projects?include_archived=true');
  const [project, setProject] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const needle = q.trim().toLowerCase();
  const has = (...xs: (string | null | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(needle));
  const devName = (id: string | null) => devices.find((d) => d.id === id)?.name ?? '';
  const results = useMemo(() => {
    if (needle.length < 2) return null;
    return {
      devices: devices.filter((d) => has(d.name, d.hostname, d.role, d.os, d.location_note, d.tags.join(' '))),
      ips: (ips.data ?? []).filter((i) => has(i.address, i.dns_name, i.notes, i.device_name)),
      services: (services.data ?? []).filter((s) => has(s.name, s.url, s.notes, s.kind, s.vmid_or_ctid?.toString())),
      notes: (notes.data ?? []).filter((n) => has(n.title, n.body_markdown)),
      projects: (projects.data ?? []).filter((p) => has(p.title, p.description_markdown, p.tags.join(' '))),
    };
  }, [needle, devices, ips.data, services.data, notes.data, projects.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const openDevice = (id: string) => { select({ kind: 'device', id }); navigate('/'); };
  const total = results ? Object.values(results).reduce((a, b) => a + b.length, 0) : 0;

  const Group = ({ title, children, n }: { title: string; n: number; children: React.ReactNode }) => n === 0 ? null : (
    <section className="card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title} ({n})</h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">{children}</ul>
    </section>
  );
  const Row = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
    <li><button className="flex w-full items-center gap-2 px-1 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={onClick}>{children}</button></li>
  );
  return (
    <div className="space-y-4">
      <div className="relative">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input py-2.5 pl-9 text-base" placeholder="Search devices, IPs, services, notes and projects" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Global search" />
      </div>
      {!results && <p className="text-sm text-slate-500">Type at least two characters.</p>}
      {results && total === 0 && <p className="text-sm text-slate-500">Nothing matches “{q}”.</p>}
      {results && (
        <div className="grid gap-4 md:grid-cols-2">
          <Group title="Devices" n={results.devices.length}>{results.devices.map((d) => <Row key={d.id} onClick={() => openDevice(d.id)}><StatusDot status={d.status} /><span className="flex-1">{d.name}</span><span className="text-xs text-slate-500">{d.role}</span></Row>)}</Group>
          <Group title="IP addresses" n={results.ips.length}>{results.ips.map((i) => <Row key={i.id} onClick={() => openDevice(i.device_id)}><span className="font-mono text-xs">{i.address}</span><span className="flex-1 text-xs text-slate-500">{i.dns_name}</span><span className="text-xs">{i.device_name}</span></Row>)}</Group>
          <Group title="Services" n={results.services.length}>{results.services.map((s) => <Row key={s.id} onClick={() => openDevice(s.device_id)}><StatusDot status={s.status} /><span className="flex-1">{s.name}</span><span className="text-xs text-slate-500">{s.kind} on {devName(s.device_id)}</span></Row>)}</Group>
          <Group title="Notes" n={results.notes.length}>{results.notes.map((n) => <Row key={n.id} onClick={() => (n.device_id ? openDevice(n.device_id) : setNote(n))}><Icon name="docs" size={13} /><span className="flex-1">{n.title}</span><span className="text-xs text-slate-500">{n.device_id ? devName(n.device_id) : n.service_id ? 'service' : 'global'}</span></Row>)}</Group>
          <Group title="Projects" n={results.projects.length}>{results.projects.map((p) => <Row key={p.id} onClick={() => setProject(p.id)}><Icon name="projects" size={13} /><span className="flex-1">{p.title}</span><span className="text-xs text-slate-500">{p.archived ? 'Archived' : STATUS_LABEL[p.status]}</span></Row>)}</Group>
        </div>
      )}
      {project && <ProjectDrawer projectId={project} overlay onClose={() => { setProject(null); void projects.reload(); }} />}
      {note && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{note.title}</h3><button className="btn btn-ghost btn-sm" onClick={() => setNote(null)} aria-label="Close note"><Icon name="close" size={13} /></button></div>
          <pre className="whitespace-pre-wrap text-sm">{note.body_markdown}</pre>
        </div>
      )}
    </div>
  );
}

function IpPlan() {
  const ips = useFetch<IpAddress[]>('/ip-addresses');
  const vlans = useFetch<Vlan[]>('/vlans');
  const { devices, select } = useLab();
  const navigate = useNavigate();
  const [vlan, setVlan] = useState('');
  const [status, setStatus] = useState('');
  const rows = useMemo(() => (ips.data ?? [])
    .filter((i) => !vlan || (vlan === 'none' ? !i.vlan_id : i.vlan_id === vlan))
    .filter((i) => !status || devices.find((d) => d.id === i.device_id)?.status === status)
    .sort((a, b) => ipKey(a.address) - ipKey(b.address) || a.address.localeCompare(b.address)), [ips.data, vlan, status, devices]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-lg font-semibold">IP address plan</h1>
        <label><span className="label">VLAN</span>
          <select className="input w-48" value={vlan} onChange={(e) => setVlan(e.target.value)}>
            <option value="">All VLANs</option><option value="none">No VLAN</option>
            {vlans.data?.map((v) => <option key={v.id} value={v.id}>{v.vlan_number} · {v.name}</option>)}
          </select>
        </label>
        <label><span className="label">Device status</span>
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>{DEVICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {!rows.length ? <p className="text-sm text-slate-500">No IP addresses{vlan || status ? ' match these filters' : ' yet. Add them from a device’s Network tab'}.</p> : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Address</th><th>Device</th><th>DNS name</th><th>Kind</th><th>VLAN</th><th>Status</th><th>Warnings</th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const d = devices.find((x) => x.id === i.device_id);
                return (
                  <tr key={i.id}>
                    <td className="font-mono text-xs">{i.is_primary && <span className="mr-1 text-amber-500" title="Primary">★</span>}{i.address}/{i.prefix_length}</td>
                    <td><button className="text-sky-600 hover:underline dark:text-sky-400" onClick={() => { select({ kind: 'device', id: i.device_id }); navigate('/'); }}>{i.device_name}</button></td>
                    <td className="text-xs">{i.dns_name ?? '—'}</td>
                    <td className="text-xs">{i.kind}</td>
                    <td className="text-xs">{i.vlan_number ?? '—'}</td>
                    <td className="text-xs"><span className="inline-flex items-center gap-1.5"><StatusDot status={d?.status ?? 'unknown'} />{d?.status}</span></td>
                    <td className="text-xs text-amber-600 dark:text-amber-300">{i.warnings.map((w) => w.message).join('; ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Inventory() {
  const { devices, templates, racks } = useLab();
  const ips = useFetch<IpAddress[]>('/ip-addresses');
  const primary = (id: string) => ips.data?.find((i) => i.device_id === id && i.is_primary)?.address ?? ips.data?.find((i) => i.device_id === id)?.address;
  const rows = [...devices].filter((d) => templates.find((t) => t.id === d.template_id)?.category !== 'shelf').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const where = (id: string) => {
    const d = devices.find((x) => x.id === id)!;
    const t = templates.find((x) => x.id === d.template_id);
    if (d.rack_unit_start) return `${racks.find((r) => r.id === d.rack_id)?.name ?? 'Rack'} U${d.rack_unit_start}${t && t.height_u > 1 ? `-${d.rack_unit_start + t.height_u - 1}` : ''}`;
    if (d.shelf_device_id) return `${devices.find((x) => x.id === d.shelf_device_id)?.name} slot ${d.shelf_slot}`;
    return 'Unracked';
  };
  return (
    <div>
      <div className="mb-4 flex items-center">
        <h1 className="mr-auto text-lg font-semibold">Device inventory</h1>
        <button className="btn no-print" onClick={() => window.print()}><Icon name="print" size={14} /> Print</button>
      </div>
      <p className="mb-3 hidden text-xs print:block">RackMap inventory, printed {new Date().toLocaleString()}</p>
      <div className="card overflow-x-auto print:border-0 print:shadow-none">
        <table className="table-base">
          <thead><tr><th>Name</th><th>Model</th><th>Location</th><th>Hostname</th><th>Primary IP</th><th>OS</th><th>Role</th><th>Status</th><th>Tags</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">{d.name}</td>
                <td className="text-xs">{templates.find((t) => t.id === d.template_id)?.name}</td>
                <td className="text-xs">{where(d.id)}</td>
                <td className="text-xs">{d.hostname ?? '—'}</td>
                <td className="font-mono text-xs">{primary(d.id) ?? '—'}</td>
                <td className="text-xs">{d.os ?? '—'}</td>
                <td className="text-xs">{d.role ?? '—'}</td>
                <td className="text-xs">{d.status}</td>
                <td className="text-xs">{d.tags.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Vlans() {
  const vlans = useFetch<Vlan[]>('/vlans');
  const [editing, setEditing] = useState<Vlan | 'new' | null>(null);
  return (
    <div>
      <div className="mb-4 flex items-center">
        <h1 className="mr-auto text-lg font-semibold">VLANs</h1>
        <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" size={13} /> New VLAN</button>
      </div>
      {!vlans.data?.length ? <p className="text-sm text-slate-500">No VLANs defined.</p> : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>VLAN</th><th>Name</th><th>Subnet</th><th /></tr></thead>
            <tbody>
              {vlans.data.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono">{v.vlan_number}</td><td>{v.name}</td><td className="font-mono text-xs">{v.subnet ?? '—'}</td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" aria-label={`Edit VLAN ${v.vlan_number}`} onClick={() => setEditing(v)}><Icon name="edit" size={12} /></button>
                    <button className="btn btn-ghost btn-sm" aria-label={`Delete VLAN ${v.vlan_number}`} onClick={async () => {
                      if (!(await confirmDialog({ title: 'Delete VLAN?', message: `Delete VLAN ${v.vlan_number}? IPs keep their address but lose the VLAN.`, danger: true, confirmLabel: 'Delete' }))) return;
                      try { await api.del(`/vlans/${v.id}`); void vlans.reload(); } catch (e) { toast.error(e); }
                    }}><Icon name="trash" size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <VlanDialog vlan={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void vlans.reload(); }} />}
    </div>
  );
}
