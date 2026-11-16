import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLab } from '../../store/lab';
import { Icon } from '../Icon';
import { StatusDot } from '../ui';
import { OverviewTab } from './OverviewTab';
import { NetworkTab } from './NetworkTab';
import { ServicesTab } from './ServicesTab';
import { NotesPanel } from './NotesPanel';
import { VaultTab } from '../vault/VaultTab';

const TABS = ['Overview', 'Network', 'Services', 'Notes', 'Vault'] as const;
type Tab = (typeof TABS)[number];

/** Right drawer for the selected device (shared by the rack and topology views). */
export function DeviceDrawer() {
  const { selection, devices, templates, select } = useLab();
  const device = selection?.kind === 'device' ? devices.find((d) => d.id === selection.id) : undefined;
  const [tab, setTab] = useState<Tab>('Overview');
  useEffect(() => { if (!device) setTab('Overview'); }, [device]);
  const tpl = device ? templates.find((t) => t.id === device.template_id) : undefined;

  return (
    <AnimatePresence initial={false}>
      {device && tpl && (
        <motion.aside
          key="drawer"
          className="no-print flex w-[420px] max-w-[92vw] shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0d121c] max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-2xl"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.18 }}
          aria-label={`${device.name} details`}
        >
          <header className="flex items-start gap-2 border-b border-slate-200 px-4 pb-2 pt-3 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusDot status={device.status} />
                <h2 className="truncate text-base font-semibold">{device.name}</h2>
              </div>
              <p className="truncate text-xs text-slate-500">{tpl.name}{device.hostname ? ` · ${device.hostname}` : ''}</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => select(null)} aria-label="Close details"><Icon name="close" size={14} /></button>
          </header>
          <div role="tablist" aria-label="Device sections" className="flex gap-1 border-b border-slate-200 px-2 dark:border-slate-800"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = TABS.indexOf(tab);
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}>
            {TABS.map((t) => (
              <button key={t} id={`tab-${t}`} role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1}
                className={`border-b-2 px-2.5 py-2 text-sm transition ${tab === t ? 'border-sky-500 font-medium text-slate-900 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'Overview' && <OverviewTab device={device} tpl={tpl} />}
            {tab === 'Network' && <NetworkTab device={device} />}
            {tab === 'Services' && <ServicesTab device={device} />}
            {tab === 'Notes' && <NotesPanel scope={{ device_id: device.id }} />}
            {tab === 'Vault' && <VaultTab device={device} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
