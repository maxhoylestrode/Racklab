import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEVICE_STATUSES, type IpAddress, type Note, type Project, type Service, type Vlan } from '@rackmap/shared';
import { useLab } from '../store/lab';
import { toast } from '../store/toast';
import { useFetch } from '../lib/useFetch';
import { api } from '../lib/api';
import { NotesPanel } from '../components/drawer/NotesPanel';
import { VlanDialog } from '../components/drawer/NetworkTab';
import { ProjectDrawer } from '../components/projects/ProjectDrawer';
import { useProjectMeta } from '../store/projectMeta';
import { StatusDot, confirmDialog } from '../components/ui';
import { Icon } from '../components/Icon';
import { PageHeader, SummaryCard, TabPanel, Tabs } from '../components/primitives';
import { Dropdown, STATUS_COLOR } from '../components/Select';

/** The page's one teal card: addresses in use, with a bar per VLAN (real data only). */
function IpSummary() {
  const ips = useFetch<IpAddress[]>('/ip-addresses');
  const list = ips.data ?? [];
  const by = new Map<string, number>();
  for (const i of list) { const k = i.vlan_number != null ? `VLAN ${i.vlan_number}` : 'None'; by.set(k, (by.get(k) ?? 0) + 1); }
  const conflicts = list.filter((i) => i.warnings.length).length;
  return (
    <div className="max-lg:hidden">
      <SummaryCard label="IP addresses" value={list.length} caption={conflicts ? `${conflicts} with a conflict. See the IP plan.` : 'No duplicate or out-of-subnet addresses.'}
        bars={[...by.entries()].sort().slice(0, 8).map(([label, value]) => ({ label, value }))} />
    </div>
  );
}

// Inventory moved to its own page (the home page).
const SECTIONS = ['Search', 'IP plan', 'Notes', 'VLANs'] as const;
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
    <div className="h-full overflow-y-auto">
      <PageHeader title="Docs" description="Search everything, the IP plan, lab-wide notes and VLANs.">
        <Tabs tabs={SECTIONS} value={section} onChange={setSection} label="Docs sections" idPrefix="docs" className="no-print border-b border-line" />
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <IpSummary />
      <TabPanel idPrefix="docs" value={section} className="min-w-0">
        <div>
          {section === 'Search' && <GlobalSearch />}
          {section === 'IP plan' && <IpPlan />}
          {section === 'Notes' && (
            <div>
              <h1 className="text-lg font-medium">Global notes</h1>
              <p className="mb-6 mt-1 text-sm text-ink-2">Lab-wide notes such as ISP details and port forwarding rules.</p>
              <NotesPanel scope={{ global: true }} />
            </div>
          )}
          {section === 'VLANs' && <Vlans />}
        </div>
      </TabPanel>
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
  const meta = useProjectMeta();
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
    <section className="surface-solid rounded-panel p-2">
      <h2 className="eyebrow flex h-8 items-center gap-2 px-2">{title}<span className="font-mono normal-case tracking-normal">{n}</span></h2>
      <ul>{children}</ul>
    </section>
  );
  const Row = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
    <li><button className="flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-sm text-ink transition-colors duration-fast hover:bg-surface-hover" onClick={onClick}>{children}</button></li>
  );
  return (
    <div className="space-y-4">
      <div className="relative">
        <Icon name="search" size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
        <input className="input pl-10 text-md" style={{ height: 44 }} placeholder="Search devices, IPs, services, notes and projects" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Global search" />
      </div>
      {!results && <p className="text-sm text-ink-2">Type at least two characters.</p>}
      {results && total === 0 && <p className="text-sm text-ink-2">Nothing matches “{q}”.</p>}
      {results && (
        <div className="grid items-start gap-2 md:grid-cols-2">
          <Group title="Devices" n={results.devices.length}>{results.devices.map((d) => <Row key={d.id} onClick={() => openDevice(d.id)}><StatusDot status={d.status} /><span className="flex-1 truncate">{d.name}</span><span className="truncate text-xs text-ink-2">{d.role}</span></Row>)}</Group>
          <Group title="IP addresses" n={results.ips.length}>{results.ips.map((i) => <Row key={i.id} onClick={() => openDevice(i.device_id)}><span className="w-28 shrink-0 font-mono text-xs">{i.address}</span><span className="flex-1 truncate font-mono text-xs text-ink-2">{i.dns_name}</span><span className="truncate text-xs">{i.device_name}</span></Row>)}</Group>
          <Group title="Services" n={results.services.length}>{results.services.map((s) => <Row key={s.id} onClick={() => openDevice(s.device_id)}><StatusDot status={s.status} /><span className="flex-1">{s.name}</span><span className="text-xs text-ink-2">{s.kind} on {devName(s.device_id)}</span></Row>)}</Group>
          <Group title="Notes" n={results.notes.length}>{results.notes.map((n) => <Row key={n.id} onClick={() => (n.device_id ? openDevice(n.device_id) : setNote(n))}><Icon name="docs" className="text-ink-2" /><span className="flex-1">{n.title}</span><span className="text-xs text-ink-2">{n.device_id ? devName(n.device_id) : n.service_id ? 'service' : 'global'}</span></Row>)}</Group>
          <Group title="Projects" n={results.projects.length}>{results.projects.map((p) => <Row key={p.id} onClick={() => setProject(p.id)}><Icon name="projects" className="text-ink-2" /><span className="flex-1">{p.title}</span><span className="text-xs text-ink-2">{p.archived ? 'Archived' : meta.status(p.status).label}</span></Row>)}</Group>
        </div>
      )}
      {project && <ProjectDrawer projectId={project} overlay onClose={() => { setProject(null); void projects.reload(); }} />}
      {note && (
        <div className="surface-solid rounded-panel p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">{note.title}</h3><button className="btn btn-ghost btn-sm" onClick={() => setNote(null)} aria-label="Close note"><Icon name="close" size={13} /></button></div>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-ink">{note.body_markdown}</pre>
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
        <div className="mr-auto"><h1 className="text-lg font-medium">IP address plan</h1><p className="mt-1 text-sm text-ink-2">Every address, sorted numerically.</p></div>
        <label><span className="label">VLAN</span>
          <Dropdown label="VLAN" className="w-48" value={vlan} onChange={setVlan}
            options={[{ value: '', label: 'All VLANs' }, { value: 'none', label: 'No VLAN' }, ...(vlans.data ?? []).map((v) => ({ value: v.id, label: `${v.vlan_number} · ${v.name}` }))]} />
        </label>
        <label><span className="label">Device status</span>
          <Dropdown label="Device status" className="w-40" value={status} onChange={setStatus}
            options={[{ value: '', label: 'Any' }, ...DEVICE_STATUSES.map((s) => ({ value: s, label: s, color: STATUS_COLOR[s] }))]} />
        </label>
      </div>
      {!rows.length ? <p className="text-sm text-ink-2">No IP addresses{vlan || status ? ' match these filters' : ' yet. Add them from a device’s Network tab'}.</p> : (
        <div className="surface-solid overflow-x-auto rounded-panel">
          <table className="table-base">
            <thead><tr><th>Address</th><th>Device</th><th>DNS name</th><th>Kind</th><th>VLAN</th><th>Status</th><th>Warnings</th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const d = devices.find((x) => x.id === i.device_id);
                return (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap font-mono text-xs"><span className="inline-flex items-center gap-1"><span className="inline-flex w-4 text-ink-2">{i.is_primary && <Icon name="star" title="Primary" />}</span>{i.address}<span className="text-ink-2">/{i.prefix_length}</span></span></td>
                    <td><button className="link" onClick={() => { select({ kind: 'device', id: i.device_id }); navigate('/'); }}>{i.device_name}</button></td>
                    <td className="font-mono text-xs">{i.dns_name ?? '—'}</td>
                    <td className="text-xs">{i.kind}</td>
                    <td className="font-mono text-xs">{i.vlan_number ?? '—'}</td>
                    <td className="text-xs"><span className="inline-flex items-center gap-2"><StatusDot status={d?.status ?? 'unknown'} />{d?.status}</span></td>
                    <td className="text-xs text-warn">{i.warnings.map((w) => w.message).join('; ')}</td>
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

function Vlans() {
  const vlans = useFetch<Vlan[]>('/vlans');
  const [editing, setEditing] = useState<Vlan | 'new' | null>(null);
  return (
    <div>
      <div className="mb-4 flex items-end">
        <div className="mr-auto"><h1 className="text-lg font-medium">VLANs</h1><p className="mt-1 text-sm text-ink-2">Used by the IP plan and subnet warnings.</p></div>
        <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" /> New VLAN</button>
      </div>
      {!vlans.data?.length ? <p className="text-sm text-ink-2">No VLANs yet. Add one to group addresses and catch IPs outside their subnet.</p> : (
        <div className="surface-solid overflow-x-auto rounded-panel">
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
