import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { DEVICE_STATUSES, type Device, type DeviceStatus, type InventoryRow, type IpAddress, type Project } from '@rackmap/shared';
import { useLab, type Placement } from '../store/lab';
import { useUi } from '../store/ui';
import { toast } from '../store/toast';
import { QUICK_ADD_EVENT } from '../store/chrome';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import {
  buildRows, filterRows, sortRows, groupRows, activeFilterCount, toCsv, parseIpInput, parseTags, cellText,
  COLUMNS, NO_FILTERS, DEFAULT_SORT, type ColumnKey, type Filters, type GroupBy, type InvRow, type Sort, type SortKey,
} from '../lib/inventory';
import { DeviceDrawer } from '../components/drawer/DeviceDrawer';
import { Icon, categoryIcon } from '../components/Icon';
import { StatusDot, confirmDialog } from '../components/ui';
import { PageHeader, SearchInput, Tooltip } from '../components/primitives';
import { EditableText, PositionPicker, StatusSelect } from '../components/inventory/cells';

type EditCol = 'name' | 'role' | 'os' | 'hostname' | 'tags' | 'ip';

function loadCols(): ColumnKey[] {
  try {
    const v = JSON.parse(localStorage.getItem('rackmap.invColumns') ?? 'null');
    if (Array.isArray(v)) return COLUMNS.map((c) => c.key).filter((k) => v.includes(k));
  } catch { /* private window */ }
  return COLUMNS.filter((c) => c.defaultOn).map((c) => c.key);
}
function saveCols(v: ColumnKey[]) { try { localStorage.setItem('rackmap.invColumns', JSON.stringify(v)); } catch { /* ignore */ } }

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable], [role=dialog]');

export default function InventoryPage() {
  const lab = useLab();
  const { devices, templates, racks, selection, select } = lab;
  const extras = useFetch<InventoryRow[]>('/inventory');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<ColumnKey[]>(loadCols);
  const [active, setActive] = useState<string | null>(selection?.kind === 'device' ? selection.id : null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; col: EditCol } | null>(null);
  const [picker, setPicker] = useState<{ id: string; rect: DOMRect } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Refresh the per-device extras (IPs, counts) whenever the device list changes shape.
  const sig = useMemo(() => devices.map((d) => `${d.id}:${d.updated_at}`).join(','), [devices]);
  const firstSig = useRef(sig);
  useEffect(() => { if (sig !== firstSig.current) { firstSig.current = sig; void extras.reload(); } }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => buildRows(devices, templates, racks, extras.data), [devices, templates, racks, extras.data]);
  const rows = useMemo(() => sortRows(filterRows(all, filters), sort), [all, filters, sort]);
  const groups = useMemo(() => groupRows(rows, groupBy), [rows, groupBy]);
  const visible = useMemo(() => groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows)), [groups, collapsed]);
  const roles = useMemo(() => [...new Set(devices.map((d) => d.role).filter(Boolean) as string[])].sort(), [devices]);
  const tags = useMemo(() => [...new Set(devices.flatMap((d) => d.tags))].sort(), [devices]);
  const drawerId = selection?.kind === 'device' ? selection.id : null;

  // Keep the active row in step with the drawer, and reveal it (Show in inventory, or arriving from the rack).
  useEffect(() => { if (drawerId) setActive(drawerId); }, [drawerId]);
  const reveal = useUi((s) => s.reveal);
  useEffect(() => {
    if (!reveal || reveal.view !== 'inventory') return;
    setActive(reveal.id);
    useUi.getState().setReveal(null);
    requestAnimationFrame(() => tableRef.current?.querySelector(`[data-row="${reveal.id}"]`)?.scrollIntoView({ block: 'center' }));
  }, [reveal]);

  // ---------- edits (all through the existing API via the lab store) ----------
  const patch = useCallback(async (id: string, p: Parameters<typeof lab.updateDevice>[1]) => {
    try { await lab.updateDevice(id, p, { optimistic: true }); } catch (e) { toast.error(e); }
  }, [lab]);

  /** Primary IP: edit the primary row (or create one). Recorded in the undo history. */
  const saveIp = useCallback(async (row: InvRow, v: string) => {
    const cur = row.extra?.primary_ip;
    if (!v) { toast.warn('Remove addresses from the Network tab in the device panel.'); return; }
    const parsed = parseIpInput(v);
    if (!parsed) { toast.error(new Error(`"${v}" is not an IP address`)); return; }
    const before = extras.data;
    // Optimistic: show the new address at once.
    extras.setData((xs) => xs?.map((x) => (x.device_id === row.device.id
      ? { ...x, primary_ip: { id: cur?.id ?? 'pending', is_primary: true, vlan_number: cur?.vlan_number ?? null, warnings: [], ...parsed } } : x)) ?? xs);
    try {
      if (cur) {
        const prev = { address: cur.address, prefix_length: cur.prefix_length };
        const saved = await api.patch<IpAddress>(`/ip-addresses/${cur.id}`, parsed);
        for (const w of saved.warnings) toast.warn(w.message);
        lab.record({
          label: `Edit IP of ${row.device.name}`,
          undo: async () => { await api.patch(`/ip-addresses/${cur.id}`, prev); await extras.reload(); },
          redo: async () => { await api.patch(`/ip-addresses/${cur.id}`, parsed); await extras.reload(); },
        });
      } else {
        let created = await api.post<IpAddress>('/ip-addresses', { device_id: row.device.id, ...parsed, is_primary: true });
        for (const w of created.warnings) toast.warn(w.message);
        lab.record({
          label: `Add IP to ${row.device.name}`,
          undo: async () => { await api.del(`/ip-addresses/${created.id}`); await extras.reload(); },
          redo: async () => { created = await api.post<IpAddress>('/ip-addresses', { device_id: row.device.id, ...parsed, is_primary: true }); await extras.reload(); },
        });
      }
      await extras.reload();
    } catch (e) {
      extras.setData(before);
      toast.error(e);
    }
  }, [extras, lab]);

  const move = useCallback(async (id: string, p: Placement) => {
    try { await lab.moveDevice(id, p); } catch (e) { toast.error(e); throw e; }
  }, [lab]);

  const deleteIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const names = ids.map((i) => devices.find((d) => d.id === i)?.name).filter(Boolean);
    const ok = await confirmDialog({
      title: ids.length === 1 ? `Delete ${names[0]}?` : `Delete ${ids.length} devices?`,
      message: <>This removes {ids.length === 1 ? 'the device' : <>these <strong>{ids.length}</strong> devices</>} with their ports, cables, IPs, services, notes and credentials. You can undo with Ctrl+Z.</>,
      danger: true,
      confirmLabel: ids.length === 1 ? 'Delete device' : `Delete ${ids.length} devices`,
    });
    if (!ok) return;
    try {
      await lab.batch(ids.length === 1 ? `Delete ${names[0]}` : `Delete ${ids.length} devices`, async () => { for (const i of ids) await lab.deleteDevice(i); });
      setChecked(new Set());
      void lab.refreshBadges();
    } catch (e) { toast.error(e); }
  }, [devices, lab]);

  // ---------- keyboard ----------
  const moveActive = useCallback((d: 1 | -1) => {
    if (!visible.length) return;
    const i = visible.findIndex((r) => r.device.id === active);
    const next = visible[Math.min(visible.length - 1, Math.max(0, i < 0 ? 0 : i + d))].device.id;
    setActive(next);
    if (drawerId) select({ kind: 'device', id: next });
    requestAnimationFrame(() => tableRef.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [visible, active, drawerId, select]);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/' && !isTyping(e.target)) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (isTyping(e.target) || picker) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveActive(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Escape') { if (drawerId) { select(null); } else if (checked.size) setChecked(new Set()); return; }
      if (!active) return;
      if (e.key === 'Enter' && !(e.target as HTMLElement).closest('[data-cell], button, a')) { e.preventDefault(); select({ kind: 'device', id: active }); }
      else if (e.key.toLowerCase() === 'e') { e.preventDefault(); setEditing({ id: active, col: 'name' }); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); await deleteIds(checked.size ? [...checked] : [active]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveActive, drawerId, select, active, checked, deleteIds, picker]);

  // ---------- selection ----------
  const toggleCheck = (id: string, e: MouseEvent | { shiftKey: boolean }) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (e.shiftKey && anchor.current) {
        const ids = visible.map((r) => r.device.id);
        const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0 && b >= 0) { for (const x of ids.slice(a, b + 1)) next.add(x); return next; }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      anchor.current = id;
      return next;
    });
  };
  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.device.id));
  const openRow = (id: string) => { setActive(id); select({ kind: 'device', id }); };

  const setColsSaved = (v: ColumnKey[]) => { setCols(v); saveCols(v); };
  const exportCsv = () => {
    const blob = new Blob([toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rackmap-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const nFilters = activeFilterCount(filters);
  const online = all.filter((r) => r.device.status === 'online').length;

  return (
    <div className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="Inventory"
          description={`${all.length} device${all.length === 1 ? '' : 's'}, racked and loose. ${online} online. Click a row for details, or edit cells in place.`}
          actions={<>
            <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}><Icon name="download" />Export CSV</button>
            <button className="btn btn-ghost btn-sm max-md:hidden" onClick={() => window.print()}><Icon name="print" />Print</button>
          </>} />

        <Toolbar filters={filters} setFilters={setFilters} roles={roles} tags={tags} groupBy={groupBy} setGroupBy={setGroupBy}
          cols={cols} setCols={setColsSaved} searchRef={searchRef} nFilters={nFilters} shown={rows.length} total={all.length} />

        {checked.size > 0 && <BulkBar ids={[...checked]} roles={roles} tags={tags} onClear={() => setChecked(new Set())} onDelete={() => void deleteIds([...checked])} />}

        <div ref={tableRef} className="panel relative mt-3 min-h-0 flex-1 overflow-auto rounded-panel" role="region" aria-label="Device inventory" tabIndex={-1}>
          <QuickAdd onCreated={(d) => openRow(d.id)} />
          {/* phones: a card list */}
          <ul className="md:hidden">
            {visible.map((r) => (
              <li key={r.device.id}>
                <button data-row={r.device.id} onClick={() => openRow(r.device.id)} aria-current={drawerId === r.device.id}
                  className={`flex w-full items-center gap-3 border-t border-line px-3 py-3 text-left ${drawerId === r.device.id ? 'bg-surface-hover' : ''}`}>
                  <span className="icon-tile"><Icon name={categoryIcon(r.tpl?.category)} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate text-base font-medium text-ink">{r.device.name}</span><StatusDot status={r.device.status} /></span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                      <span className="font-mono">{r.extra?.primary_ip?.address ?? 'no IP'}</span><span aria-hidden>·</span><span className="truncate">{r.position}</span>
                    </span>
                  </span>
                  <Icon name="chevronRight" className="text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
          <table className="table-base max-md:hidden" aria-label="Devices" aria-rowcount={visible.length}>
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className="w-8 !pr-0"><input type="checkbox" aria-label="Select all visible devices" checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(visible.map((r) => r.device.id)))} /></th>
                <SortTh k="name" sort={sort} setSort={setSort}>Name</SortTh>
                {cols.map((c) => <SortTh key={c} k={c === 'creds' ? 'creds' : c as SortKey} sort={sort} setSort={setSort}>{COLUMNS.find((x) => x.key === c)!.label}</SortTh>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {groupBy !== 'none' && (
                    <tr className="hover:!bg-transparent">
                      <td colSpan={cols.length + 2} className="!bg-panel-sunk !py-1">
                        <button className="flex h-7 items-center gap-2 text-sm font-medium text-ink" aria-expanded={!collapsed.has(g.key)}
                          onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                          <Icon name={collapsed.has(g.key) ? 'chevronRight' : 'chevronDown'} className="text-ink-2" />
                          {groupBy === 'status' ? <span className="inline-flex items-center gap-2"><StatusDot status={g.key} />{g.label}</span> : g.label}
                          <span className="font-mono text-xs font-normal text-ink-2">{g.rows.length}</span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!collapsed.has(g.key) && g.rows.map((r) => (
                    <Row key={r.device.id} r={r} cols={cols} active={active === r.device.id} open={drawerId === r.device.id} checked={checked.has(r.device.id)}
                      editing={editing?.id === r.device.id ? editing.col : null}
                      setEditing={(col) => setEditing(col ? { id: r.device.id, col } : null)}
                      onCheck={(e) => toggleCheck(r.device.id, e)} onOpen={() => openRow(r.device.id)}
                      onPatch={(p) => void patch(r.device.id, p)} onIp={(v) => void saveIp(r, v)}
                      onPosition={(rect) => setPicker({ id: r.device.id, rect })} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!all.length && lab.loaded && (
            <p className="px-4 py-6 text-sm text-ink-2">No devices yet. Add your first one above, or import a backup in Settings.</p>
          )}
          {!!all.length && !rows.length && (
            <div className="flex items-center gap-3 px-4 py-6 text-sm text-ink-2">No devices match these filters.
              <button className="btn btn-ghost btn-sm" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
            </div>
          )}
        </div>
      </div>
      <DeviceDrawer />
      {picker && (() => {
        const d = devices.find((x) => x.id === picker.id);
        return d ? <PositionPicker device={d} anchor={picker.rect} onClose={() => setPicker(null)} onMove={(p) => move(d.id, p)} /> : null;
      })()}
    </div>
  );
}

// ---------------------------------------------------------------- table row
function Row({ r, cols, active, open, checked, editing, setEditing, onCheck, onOpen, onPatch, onIp, onPosition }: {
  r: InvRow; cols: ColumnKey[]; active: boolean; open: boolean; checked: boolean; editing: EditCol | null; setEditing: (c: EditCol | null) => void;
  onCheck: (e: MouseEvent) => void; onOpen: () => void; onPatch: (p: Partial<Device>) => void; onIp: (v: string) => void; onPosition: (rect: DOMRect) => void;
}) {
  const d = r.device;
  const ed = (col: EditCol) => ({ editing: editing === col, setEditing: (on: boolean) => setEditing(on ? col : null) });
  const ip = r.extra?.primary_ip;
  return (
    <tr data-row={d.id} data-active={active || undefined} aria-selected={open} onClick={onOpen}
      className={`group cursor-pointer ${open ? '!bg-surface-hover' : ''} ${active ? 'shadow-[inset_2px_0_0_rgb(var(--accent-rgb))]' : ''}`}>
      <td className="!pr-0" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select ${d.name}`} checked={checked} onChange={() => {}} onClick={onCheck} />
      </td>
      <td className="min-w-[220px]">
        <div className="flex items-center gap-3">
          <span className="icon-tile" aria-hidden><Icon name={categoryIcon(r.tpl?.category)} /></span>
          <div className="min-w-0">
            <EditableText label={`Name of ${d.name}`} className="!h-5" value={d.name} {...ed("name")} onSave={(v) => { if (v) onPatch({ name: v }); }}
              display={<span className="whitespace-nowrap font-medium text-ink">{d.name}</span>} />
            <p className="truncate text-xs text-ink-2">{d.role ? `${d.role} · ${r.tpl?.name ?? ''}` : r.tpl?.name}</p>
          </div>
        </div>
      </td>
      {cols.map((c) => {
        switch (c) {
          case 'status': return <td key={c}><StatusSelect device={d} onChange={(status) => onPatch({ status })} /></td>;
          case 'ip': return (
            <td key={c} className="whitespace-nowrap">
              <span className="flex items-center gap-2">
                <EditableText label={`Primary IP of ${d.name}`} mono value={ip ? `${ip.address}/${ip.prefix_length}` : ''} placeholder="Add IP" {...ed('ip')} onSave={onIp}
                  display={ip ? <span className="font-mono">{ip.address}<span className="text-ink-2">/{ip.prefix_length}</span></span> : undefined} />
                {r.extra?.ip_conflict && (
                  <Tooltip content={(ip?.warnings.map((w) => w.message).join('. ')) || 'Another address on this device has a conflict'}>
                    <span className="chip chip-warn" tabIndex={0}><Icon name="warning" />{ip?.warnings[0]?.code === 'outside_vlan_subnet' ? 'subnet' : 'conflict'}</span>
                  </Tooltip>
                )}
              </span>
            </td>
          );
          case 'role': return <td key={c}><EditableText label={`Role of ${d.name}`} value={d.role ?? ''} {...ed('role')} onSave={(v) => onPatch({ role: v || null })} /></td>;
          case 'hostname': return <td key={c}><EditableText label={`Hostname of ${d.name}`} mono value={d.hostname ?? ''} {...ed('hostname')} onSave={(v) => onPatch({ hostname: v || null })} /></td>;
          case 'os': return <td key={c}><EditableText label={`OS of ${d.name}`} value={d.os ?? ''} {...ed('os')} onSave={(v) => onPatch({ os: v || null })} /></td>;
          case 'template': return <td key={c} className="whitespace-nowrap text-ink-2">{r.tpl?.name}</td>;
          case 'position': return (
            <td key={c} className="whitespace-nowrap">
              <button data-cell className="-mx-1 flex h-7 items-center gap-1 rounded-sm px-1 hover:bg-surface-hover hover:shadow-[0_0_0_1px_var(--line-strong)]"
                aria-label={`Rack position of ${d.name}: ${r.position}. Press Enter to move`}
                onClick={(e) => { e.stopPropagation(); onPosition(e.currentTarget.getBoundingClientRect()); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onPosition(e.currentTarget.getBoundingClientRect()); } }}>
                <span className={r.racked ? 'text-ink' : 'text-ink-2'}>{r.position}</span>
              </button>
            </td>
          );
          case 'projects': return <td key={c} className="font-mono text-ink-2">{r.extra?.open_projects ? <span className="chip">{r.extra.open_projects} open</span> : '0'}</td>;
          case 'creds': return (
            <td key={c} className="text-ink-2">
              {r.extra?.credential_count ? <span className="inline-flex items-center gap-1" title="Credentials (secrets stay in the vault)"><Icon name="lock" /><span className="font-mono">{r.extra.credential_count}</span></span> : <span className="font-mono">0</span>}
            </td>
          );
          case 'tags': return (
            <td key={c}>
              <EditableText label={`Tags of ${d.name}`} value={d.tags.join(', ')} placeholder="Add tags" {...ed('tags')} onSave={(v) => onPatch({ tags: parseTags(v) })}
                display={d.tags.length ? <span className="flex gap-1">{d.tags.slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}{d.tags.length > 3 && <span className="chip">+{d.tags.length - 3}</span>}</span> : undefined} />
            </td>
          );
          case 'updated': return <td key={c} className="whitespace-nowrap font-mono text-xs text-ink-2">{cellText(r, 'updated')}</td>;
        }
      })}
    </tr>
  );
}

function SortTh({ k, sort, setSort, children }: { k: SortKey; sort: Sort; setSort: (s: Sort) => void; children: string }) {
  const on = sort.key === k;
  return (
    <th aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 uppercase tracking-label hover:text-ink" onClick={() => setSort(on ? (sort.dir === 1 ? { key: k, dir: -1 } : DEFAULT_SORT) : { key: k, dir: 1 })}>
        {children}{on && <Icon name={sort.dir === 1 ? 'chevronUp' : 'chevronDown'} className="text-ink" />}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------- toolbar
function Toolbar({ filters, setFilters, roles, tags, groupBy, setGroupBy, cols, setCols, searchRef, nFilters, shown, total }: {
  filters: Filters; setFilters: (f: Filters) => void; roles: string[]; tags: string[]; groupBy: GroupBy; setGroupBy: (g: GroupBy) => void;
  cols: ColumnKey[]; setCols: (c: ColumnKey[]) => void; searchRef: React.RefObject<HTMLInputElement>; nFilters: number; shown: number; total: number;
}) {
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput ref={searchRef} wrapperClassName="w-full sm:w-64" placeholder="Search devices   /" value={filters.q} aria-label="Search devices"
          onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
        <div className="segmented max-md:hidden" role="group" aria-label="Group by">
          {(['none', 'rack', 'role', 'status'] as const).map((g) => (
            <button key={g} className="btn" aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}>{g === 'none' ? 'No groups' : `By ${g}`}</button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="font-mono text-xs text-ink-2" role="status">{shown === total ? `${total}` : `${shown} of ${total}`}</span>
        <ColumnMenu cols={cols} setCols={setCols} />
      </div>
      <div className="flex items-center gap-2 max-md:-mx-2 max-md:overflow-x-auto max-md:px-2 max-md:pb-1 md:flex-wrap" role="group" aria-label="Filters">
        <span className="eyebrow mr-1">Filters{nFilters ? ` (${nFilters})` : ''}</span>
        {DEVICE_STATUSES.map((s) => (
          <button key={s} className="chip-filter" aria-pressed={filters.status.includes(s)} onClick={() => setFilters({ ...filters, status: toggleIn(filters.status, s as DeviceStatus) })}>
            <StatusDot status={s} />{s}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden />
        <button className="chip-filter" aria-pressed={filters.placement === 'racked'} onClick={() => setFilters({ ...filters, placement: filters.placement === 'racked' ? '' : 'racked' })}>Racked</button>
        <button className="chip-filter" aria-pressed={filters.placement === 'unracked'} onClick={() => setFilters({ ...filters, placement: filters.placement === 'unracked' ? '' : 'unracked' })}>Unracked</button>
        <button className="chip-filter" aria-pressed={filters.hasProjects} onClick={() => setFilters({ ...filters, hasProjects: !filters.hasProjects })}>Open projects</button>
        <button className="chip-filter" aria-pressed={filters.ipConflict} onClick={() => setFilters({ ...filters, ipConflict: !filters.ipConflict })}>IP conflict</button>
        <ChipSelect label="Role" options={roles} value={filters.role} onChange={(role) => setFilters({ ...filters, role })} />
        <ChipSelect label="Tag" options={tags} value={filters.tag} onChange={(tag) => setFilters({ ...filters, tag })} />
        {nFilters > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ ...NO_FILTERS, q: filters.q })}>Clear</button>}
      </div>
    </div>
  );
}

/** A filter chip that opens a checklist (role, tag). */
function ChipSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!options.length) return null;
  return (
    <div className="relative" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button className="chip-filter" aria-pressed={value.length > 0} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}{value.length ? `: ${value.length === 1 ? value[0] : value.length}` : ''}<Icon name="chevronDown" />
      </button>
      {open && (
        <div className="menu absolute left-0 top-9 max-h-72 w-56 overflow-y-auto" role="group" aria-label={`${label} filter`}>
          {options.map((o) => (
            <label key={o} className="menu-item cursor-pointer">
              <input type="checkbox" checked={value.includes(o)} onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnMenu({ cols, setCols }: { cols: ColumnKey[]; setCols: (c: ColumnKey[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative max-md:hidden" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button className="btn btn-ghost btn-sm" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="board" />Columns</button>
      {open && (
        <div className="menu absolute right-0 top-9 w-52" role="group" aria-label="Visible columns">
          {COLUMNS.map((c) => (
            <label key={c.key} className="menu-item cursor-pointer">
              <input type="checkbox" checked={cols.includes(c.key)}
                onChange={() => setCols(cols.includes(c.key) ? cols.filter((x) => x !== c.key) : COLUMNS.map((x) => x.key).filter((k) => cols.includes(k) || k === c.key))} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- quick add
function QuickAdd({ onCreated }: { onCreated: (d: Device) => void }) {
  const { templates, createDevice } = useLab();
  const [name, setName] = useState('');
  const [tid, setTid] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Default to a plain rack device rather than whatever sorts first (often a shelf).
  useEffect(() => { if (!tid && templates.length) setTid((templates.find((t) => t.category === 'other' && t.form_factor === 'rack') ?? templates.find((t) => t.category === 'switch') ?? templates[0]).id); }, [templates, tid]);
  useEffect(() => {
    const f = () => ref.current?.focus();
    window.addEventListener(QUICK_ADD_EVENT, f);
    return () => window.removeEventListener(QUICK_ADD_EVENT, f);
  }, []);
  const submit = async () => {
    if (!name.trim() || !tid || busy) return;
    setBusy(true);
    try {
      const d = await createDevice({ name: name.trim(), template_id: tid, status: 'unknown' });
      setName('');
      toast.success(`Added ${d.name} to the unracked tray`);
      onCreated(d);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <form className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-sunk px-3 py-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Add a device">
      <span className="icon-tile !border-dashed !bg-transparent"><Icon name="plus" /></span>
      <input ref={ref} className="input h-7 min-w-[160px] flex-1 border-transparent bg-transparent px-2 text-sm hover:border-line-strong" style={{ height: 28 }}
        placeholder="Add a device: type a name, pick a template, press Enter" value={name} onChange={(e) => setName(e.target.value)} aria-label="New device name" maxLength={100} />
      <select className="input h-7 w-auto max-w-[200px] text-sm" style={{ height: 28 }} value={tid} onChange={(e) => setTid(e.target.value)} aria-label="New device template">
        {/* Shelves are added from the rack library; they do not appear in the inventory. */}
        {templates.filter((t) => t.category !== 'shelf').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" disabled={!name.trim() || busy}>Add</button>
    </form>
  );
}

// ---------------------------------------------------------------- bulk actions
function BulkBar({ ids, roles, tags, onClear, onDelete }: { ids: string[]; roles: string[]; tags: string[]; onClear: () => void; onDelete: () => void }) {
  const lab = useLab();
  const projects = useFetch<Project[]>('/projects?open=true');
  const [tag, setTag] = useState('');
  const [role, setRole] = useState('');
  const run = async (label: string, fn: (d: Device) => Promise<unknown> | void) => {
    try {
      await lab.batch(label, async () => { for (const id of ids) { const d = useLab.getState().devices.find((x) => x.id === id); if (d) await fn(d); } });
      toast.success(`${label}: ${ids.length} device${ids.length === 1 ? '' : 's'}`);
    } catch (e) { toast.error(e); }
  };
  const linkProject = async (pid: string) => {
    const p = projects.data?.find((x) => x.id === pid);
    if (!p) return;
    try {
      for (const id of ids) {
        if (p.links.some((l) => l.device_id === id)) continue;
        const fresh = await api.post<Project>(`/projects/${pid}/links`, { device_id: id });
        let linkId = fresh.links.find((l) => l.device_id === id)?.id;
        lab.record({
          label: `Link to ${p.title}`,
          undo: async () => { if (linkId) await api.del(`/projects/${pid}/links/${linkId}`); void lab.refreshBadges(); },
          redo: async () => { const again = await api.post<Project>(`/projects/${pid}/links`, { device_id: id }); linkId = again.links.find((l) => l.device_id === id)?.id; void lab.refreshBadges(); },
        });
      }
      toast.success(`Linked ${ids.length} device${ids.length === 1 ? '' : 's'} to ${p.title}`);
      void lab.refreshBadges();
      void projects.reload();
    } catch (e) { toast.error(e); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-panel bg-[#141414] px-3 py-2 text-sm text-[#f2f2ee] dark:bg-[#f2f2ee] dark:text-[#141414]" role="toolbar" aria-label="Bulk actions">
      <span className="font-medium">{ids.length} selected</span>
      <span className="mx-1 h-4 w-px bg-current opacity-20" aria-hidden />
      <BulkSelect label="Set status" options={DEVICE_STATUSES.map((s) => [s, s])} onPick={(s) => void run(`Set status ${s}`, (d) => lab.updateDevice(d.id, { status: s as DeviceStatus }))} />
      <BulkInput label="Add tag" placeholder="tag" value={tag} setValue={setTag} list="bulk-tags" options={tags}
        onSubmit={(t) => void run(`Add tag ${t}`, (d) => (d.tags.includes(t) ? undefined : lab.updateDevice(d.id, { tags: [...d.tags, t] })))} />
      {tags.length > 0 && <BulkSelect label="Remove tag" options={tags.map((t) => [t, t])} onPick={(t) => void run(`Remove tag ${t}`, (d) => (d.tags.includes(t) ? lab.updateDevice(d.id, { tags: d.tags.filter((x) => x !== t) }) : undefined))} />}
      <BulkInput label="Set role" placeholder="role" value={role} setValue={setRole} list="bulk-roles" options={roles}
        onSubmit={(r) => void run(`Set role ${r}`, (d) => lab.updateDevice(d.id, { role: r }))} />
      {!!projects.data?.length && <BulkSelect label="Link to project" options={projects.data.map((p) => [p.id, p.title])} onPick={(pid) => void linkProject(pid)} />}
      <div className="flex-1" />
      <button className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium text-[#ff8f88] hover:bg-white/10 dark:text-[#b9322d] dark:hover:bg-black/10" onClick={onDelete}><Icon name="trash" />Delete {ids.length}</button>
      <button className="inline-flex h-7 items-center rounded-full px-3 text-xs hover:bg-white/10 dark:hover:bg-black/10" onClick={onClear}>Clear</button>
    </div>
  );
}

function BulkSelect({ label, options, onPick }: { label: string; options: [string, string][]; onPick: (v: string) => void }) {
  return (
    <select aria-label={label} value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
      className="h-7 cursor-pointer appearance-none rounded-full border border-current/20 bg-transparent px-3 text-xs font-medium [border-color:rgb(127_127_127/0.45)]">
      <option value="">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function BulkInput({ label, placeholder, value, setValue, onSubmit, list, options }: {
  label: string; placeholder: string; value: string; setValue: (v: string) => void; onSubmit: (v: string) => void; list: string; options: string[];
}) {
  return (
    <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (v) { onSubmit(v); setValue(''); } }}>
      <input aria-label={label} placeholder={`${label}…`} value={value} onChange={(e) => setValue(e.target.value)} list={list}
        className="h-7 w-28 rounded-full border bg-transparent px-3 text-xs placeholder:text-current placeholder:opacity-70 [border-color:rgb(127_127_127/0.45)]" />
      <datalist id={list}>{options.map((o) => <option key={o} value={o} />)}</datalist>
      <span className="sr-only">{placeholder}</span>
    </form>
  );
}
