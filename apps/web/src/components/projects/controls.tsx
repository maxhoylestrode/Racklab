import { useEffect, useRef, useState } from 'react';
import { PROJECT_ICONS, type ProjectIcon } from '@rackmap/shared';
import { Icon, type IconName } from '../Icon';
import { PALETTE, cvar } from '../../store/projectMeta';
import { FloatingPanel } from '../Select';

export { FloatingPanel, PillSelect, type PillOption } from '../Select';

/** Swatch button that opens the palette plus a custom colour well. */
export function ColorPicker({ value, onChange, label, allowNone, size = 'md' }: {
  value: string | null; onChange: (c: string | null) => void; label: string; allowNone?: boolean; size?: 'sm' | 'md';
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value ?? '#3e83f8');
  useEffect(() => { if (value) setCustom(value); }, [value]);
  const set = (c: string | null) => { setOpen(false); btn.current?.focus(); if (c !== value) onChange(c); };
  const dim = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${value ?? 'no colour'}`}
        className={value ? `swatch ${dim}` : `inline-flex ${dim} shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-3 hover:text-ink-2`}
        style={cvar(value)} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {!value && <Icon name="palette" size={12} />}
      </button>
      <FloatingPanel anchor={btn} open={open} onClose={(r) => { setOpen(false); if (r) btn.current?.focus(); }} label={label} className="w-[216px] p-3">
        <div role="radiogroup" aria-label={label} className="grid grid-cols-7 gap-1.5">
          {PALETTE.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value?.toLowerCase() === c} aria-label={c} title={c}
              className="swatch" style={cvar(c)} onClick={() => set(c)} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <input type="color" value={custom} aria-label="Custom colour" onChange={(e) => setCustom(e.target.value)} />
          <button type="button" className="btn btn-sm flex-1" onClick={() => set(custom)}>Use custom</button>
        </div>
        {allowNone && <button type="button" className="btn btn-ghost btn-sm mt-2 w-full justify-start" onClick={() => set(null)}><Icon name="none" size={12} />No colour</button>}
      </FloatingPanel>
    </>
  );
}

/** Icon tile that opens a grid of project icons. */
export function IconPicker({ value, onChange, color }: { value: ProjectIcon | null; onChange: (i: ProjectIcon | null) => void; color?: string | null }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const set = (i: ProjectIcon | null) => { setOpen(false); btn.current?.focus(); if (i !== value) onChange(i); };
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Project icon: ${value ?? 'none'}`}
        className="icon-tile h-8 w-8 hover:border-line-strong" style={color ? { color } : undefined} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <Icon name={(value ?? 'none') as IconName} />
      </button>
      <FloatingPanel anchor={btn} open={open} onClose={(r) => { setOpen(false); if (r) btn.current?.focus(); }} label="Project icon" className="w-[260px] p-2">
        <div role="radiogroup" aria-label="Project icon" className="grid grid-cols-7 gap-1">
          <button type="button" role="radio" aria-checked={value === null} aria-label="No icon" title="No icon"
            className={`btn btn-ghost btn-icon btn-sm ${value === null ? 'bg-surface-hover' : ''}`} onClick={() => set(null)}><Icon name="none" /></button>
          {PROJECT_ICONS.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={i} title={i}
              className={`btn btn-ghost btn-icon btn-sm ${value === i ? 'bg-surface-hover text-ink' : 'text-ink-2'}`} onClick={() => set(i)}>
              <Icon name={i as IconName} />
            </button>
          ))}
        </div>
      </FloatingPanel>
    </>
  );
}

/** Read-only coloured tag chip. */
export function TagChip({ tag, color }: { tag: string; color: string | null }) {
  return color
    ? <span className="pill pill-sm" style={cvar(color)}>#{tag}</span>
    : <span className="text-xs text-ink-2">#{tag}</span>;
}
