import { useRef, useState } from 'react';
import { CARD_FIELDS, DEFAULT_PROJECT_DISPLAY, LIST_COLUMNS, useUi, type CardField, type ListColumn } from '../../store/ui';
import { Icon } from '../Icon';
import { FloatingPanel } from './controls';

/** Per-browser display options for the board and list. */
export function ViewOptions({ view }: { view: 'board' | 'list' }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { projectDisplay: d, setProjectDisplay: set } = useUi();
  const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: string }) => (
    <label className="menu-item cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">{children}</span>
    </label>
  );
  return (
    <>
      <button ref={btn} className="btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="sliders" /> View
      </button>
      <FloatingPanel anchor={btn} open={open} onClose={(r) => { setOpen(false); if (r) btn.current?.focus(); }} label="View options" className="w-60">
        {view === 'board' ? (
          <>
            <p className="eyebrow px-2 pb-1 pt-2">Card density</p>
            <div className="segmented mx-2 mb-2 flex" role="group" aria-label="Card density">
              {(['comfortable', 'compact'] as const).map((v) => (
                <button key={v} className="btn btn-sm flex-1 capitalize" aria-pressed={d.density === v} onClick={() => set((x) => ({ ...x, density: v }))}>{v}</button>
              ))}
            </div>
            <div className="menu-sep" />
            <p className="eyebrow px-2 pb-1 pt-2">Show on cards</p>
            {(Object.keys(CARD_FIELDS) as CardField[]).map((k) => (
              <Check key={k} checked={d.cardFields[k]} onChange={(v) => set((x) => ({ ...x, cardFields: { ...x.cardFields, [k]: v } }))}>{CARD_FIELDS[k]}</Check>
            ))}
          </>
        ) : (
          <>
            <p className="eyebrow px-2 pb-1 pt-2">Columns</p>
            {(Object.keys(LIST_COLUMNS) as ListColumn[]).map((k) => (
              <Check key={k} checked={d.listColumns[k]} onChange={(v) => set((x) => ({ ...x, listColumns: { ...x.listColumns, [k]: v } }))}>{LIST_COLUMNS[k]}</Check>
            ))}
          </>
        )}
        <div className="menu-sep" />
        <button className="menu-item text-ink-2" onClick={() => set(() => ({ ...DEFAULT_PROJECT_DISPLAY, collapsed: d.collapsed }))}>
          <Icon name="undo" size={14} />Reset to defaults
        </button>
      </FloatingPanel>
    </>
  );
}
