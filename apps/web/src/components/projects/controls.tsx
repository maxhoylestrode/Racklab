import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { PROJECT_ICONS, type ProjectIcon } from '@rackmap/shared';
import { Icon, type IconName } from '../Icon';
import { PALETTE, cvar } from '../../store/projectMeta';

/** Above dialogs (50) so pickers work inside modals; below toasts would hide them, so sit just over. */
const Z_FLOAT = 65;

/**
 * A panel pinned to an anchor, rendered in a portal so table overflow and dialogs never clip it.
 * Closes on outside press, Escape, page scroll or resize. Flips above the anchor when there is no room below.
 */
export function FloatingPanel({ anchor, open, onClose, children, matchWidth, className = '', label, role = 'dialog' }: {
  anchor: RefObject<HTMLElement>; open: boolean; onClose: (refocus: boolean) => void; children: ReactNode;
  matchWidth?: boolean; className?: string; label?: string; role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth?: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) { setPos(null); return; }
    const place = () => {
      const a = anchor.current!.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 0, w = ref.current?.offsetWidth ?? 0;
      const below = window.innerHeight - a.bottom - 8, above = a.top - 8;
      const up = h > below && above > below;
      const maxHeight = Math.max(160, Math.min(360, up ? above : below));
      const top = up ? Math.max(8, a.top - 4 - Math.min(h, maxHeight)) : a.bottom + 4;
      const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
      setPos({ left, top, minWidth: matchWidth ? a.width : undefined, maxHeight });
    };
    place();
    // Second pass once the panel has measured itself.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (ref.current?.contains(t as Node) || anchor.current?.contains(t as Node));
    const down = (e: PointerEvent) => { if (!inside(e.target)) onClose(false); };
    const scroll = (e: Event) => { if (!inside(e.target)) onClose(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(true); } };
    const resize = () => onClose(false);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    // Portal events still bubble through React: keep clicks and keys away from cards and rows underneath.
    <div ref={ref} role={role} aria-label={label} data-floating=""
      className={`menu fixed overflow-y-auto ${className}`}
      style={{ zIndex: Z_FLOAT, left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth: pos?.minWidth, maxHeight: pos?.maxHeight }}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

export interface PillOption { value: string; label: string; color?: string | null; hint?: string }

/**
 * Coloured dropdown. `pill` is the compact coloured chip used on cards and table rows; `field` matches
 * the height and border of other inputs for forms and filters. Keyboard: arrows, Home/End, letters, Enter, Escape.
 */
export function PillSelect({ value, options, onChange, label, variant = 'pill', size = 'md', className = '', disabled }: {
  value: string; options: PillOption[]; onChange: (v: string) => void; label: string;
  variant?: 'pill' | 'field'; size?: 'sm' | 'md'; className?: string; disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const cur = options.find((o) => o.value === value);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) btn.current?.focus(); };

  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  useEffect(() => { if (open) requestAnimationFrame(() => list.current?.focus()); }, [open]);
  useEffect(() => { if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const pick = (o: PillOption) => { close(true); if (o.value !== value) onChange(o.value); };

  const onListKey = (e: React.KeyboardEvent) => {
    const n = options.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const j = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const f = j >= 0 ? j : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (f >= 0) setActive(f);
    }
  };

  const dot = cur?.color ? <span className="pill-dot" style={cvar(cur.color)} aria-hidden /> : null;
  return (
    <>
      <button ref={btn} type="button" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-label={`${label}: ${cur?.label ?? 'none'}`}
        className={variant === 'pill'
          ? `pill ${size === 'sm' ? 'pill-sm' : ''} ${className}`
          : `input flex items-center gap-2 text-left ${size === 'sm' ? 'h-7 text-xs' : ''} ${className}`}
        style={variant === 'pill' ? cvar(cur?.color) : undefined}
        onClick={(e) => { e.stopPropagation(); if (open) close(false); else show(); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
        }}>
        {variant === 'pill' ? <span className="pill-dot" aria-hidden /> : dot}
        <span className="min-w-0 flex-1 truncate">{cur?.label ?? '—'}</span>
        <Icon name="chevronDown" size={12} className={variant === 'pill' ? 'opacity-70' : 'text-ink-3'} />
      </button>
      <FloatingPanel anchor={btn} open={open} onClose={close} matchWidth role="presentation" className="min-w-[176px]">
        <ul ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={label}
          aria-activedescendant={`${id}-o${active}`} onKeyDown={onListKey} className="outline-none">
          {options.map((o, i) => (
            <li key={o.value} id={`${id}-o${i}`} data-i={i} role="option" aria-selected={o.value === value}
              className={`menu-item cursor-pointer ${i === active ? 'bg-surface-hover' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              {o.color ? <span className="pill-dot" style={cvar(o.color)} aria-hidden /> : <span className="w-2" aria-hidden />}
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-xs text-ink-2">{o.hint}</span>}
              <span className="flex w-4 justify-center text-ink-2">{o.value === value && <Icon name="check" size={12} />}</span>
            </li>
          ))}
        </ul>
      </FloatingPanel>
    </>
  );
}

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
