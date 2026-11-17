import { useMemo, useState } from 'react';
import type { AuditEntry } from '@rackmap/shared';
import { useFetch } from '../lib/useFetch';
import { Icon } from '../components/Icon';

/** The last 500 actions. Secret values are never written to the log. */
export default function AuditPage() {
  const { data, loading, reload } = useFetch<AuditEntry[]>('/audit?limit=500');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const types = useMemo(() => [...new Set((data ?? []).map((a) => a.entity_type))].sort(), [data]);
  const rows = (data ?? []).filter((a) => (!type || a.entity_type === type) && (!q || `${a.action} ${a.summary}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">Audit log</h1>
            <p className="mt-1 text-sm text-ink-2">The last 500 actions, newest first. Secret values are never recorded.</p>
          </div>
          <label><span className="label">Filter</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action or summary" /></label>
          <label><span className="label">Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          <button className="btn" onClick={() => void reload()} aria-label="Refresh"><Icon name="refresh" /></button>
        </div>
        <div className="panel overflow-x-auto rounded-panel" tabIndex={0} role="region" aria-label="Audit entries">
          <table className="table-base">
            <thead><tr><th>When</th><th>Action</th><th>Type</th><th>Summary</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap font-mono text-xs text-ink-2">{new Date(a.at).toLocaleString()}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{a.action}</td>
                  <td className="text-xs">{a.entity_type}</td>
                  <td className="text-xs">{a.summary}</td>
                </tr>
              ))}
              {!loading && !rows.length && <tr><td colSpan={4} className="py-6 text-sm text-ink-2">No entries match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
