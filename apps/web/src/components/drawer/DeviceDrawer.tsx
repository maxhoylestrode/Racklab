import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLab } from '../../store/lab';
import { Icon } from '../Icon';
import { StatusDot } from '../ui';
import { Drawer, DrawerHeader, IconButton, TabPanel, Tabs } from '../primitives';
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
        <Drawer
          key="drawer"
          label={`${device.name} details`}
          className="no-print w-[400px] max-w-full shrink-0 max-md:absolute max-md:inset-0 max-md:z-drawer max-md:w-auto"
        >
          <DrawerHeader className="pb-0">
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center gap-2">
                <StatusDot status={device.status} />
                <h2 className="truncate text-md font-medium text-ink">{device.name}</h2>
              </div>
              <p className="mt-1 truncate text-xs text-ink-2">
                {tpl.name}{device.hostname && <> · <span className="font-mono">{device.hostname}</span></>}
              </p>
            </div>
            <IconButton icon="close" label="Close details" onClick={() => select(null)} />
          </DrawerHeader>
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Device sections" idPrefix="device" className="border-b border-line px-4"
            render={(t) => t === 'Vault' ? <span className="inline-flex items-center gap-1"><Icon name="lock" className="text-ink-3" />Vault</span> : t} />
          <TabPanel idPrefix="device" value={tab} className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'Overview' && <OverviewTab device={device} tpl={tpl} />}
            {tab === 'Network' && <NetworkTab device={device} />}
            {tab === 'Services' && <ServicesTab device={device} />}
            {tab === 'Notes' && <NotesPanel scope={{ device_id: device.id }} />}
            {tab === 'Vault' && <VaultTab device={device} />}
          </TabPanel>
        </Drawer>
      )}
    </AnimatePresence>
  );
}
