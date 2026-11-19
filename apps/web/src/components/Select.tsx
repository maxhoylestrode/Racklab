import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { cvar } from '../store/projectMeta';

/** Above dialogs (50) so pickers work inside modals. */
const Z_FLOAT = 65;

/**
 * A panel pinned to an anchor, rendered in a portal so table overflow and dialogs never clip it.
 * Closes on outside press, Escape, page scroll or resize. Flips above the anchor when there is no room below.
 * Dialogs check for [data-floating] and leave Escape to the open panel.
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

/** Colours for device and service statuses, matching StatusDot. */
export const STATUS_COLOR: Record<string, string> = {
  online: 'rgb(var(--ok-rgb))', running: 'rgb(var(--ok-rgb))',
  offline: 'rgb(var(--bad-rgb))', stopped: 'rgb(var(--bad-rgb))',
  planned: 'rgb(var(--unknown-rgb))', unknown: 'rgb(var(--unknown-rgb))',
};

/**
 * The app's dropdown (replaces native <select>). Variants:
 * - `field`: same height and border as other inputs, for forms, filters and toolbars;
 * - `pill`: the compact coloured chip used on cards and table rows.
 * `placeholder` shows when no option matches `value` (action menus pass value=""). `buttonClassName`
 * replaces the variant's button styling. `id` lets a <label htmlFor> point at it.
 * Keyboard: arrows, Home/End, typeahead, Enter, Escape.
 */
export function PillSelect({ value, options, onChange, label, variant = 'pill', size = 'md', className = '', buttonClassName, disabled, placeholder, id: buttonId }: {
  value: string; options: PillOption[]; onChange: (v: string) => void; label: string;
  variant?: 'pill' | 'field'; size?: 'sm' | 'md'; className?: string; buttonClassName?: string; disabled?: boolean; placeholder?: string; id?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const cur = options.find((o) => o.value === value);
  const anyColor = options.some((o) => o.color);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) btn.current?.focus(); };

  const show = () => {
    if (disabled || !options.length) return;
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

  const shown = cur?.label ?? placeholder ?? '—';
  const custom = buttonClassName !== undefined;
  return (
    <>
      <button ref={btn} id={buttonId} type="button" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-label={cur ? `${label}: ${cur.label}` : label}
        className={custom
          ? `${buttonClassName} ${className}`
          : variant === 'pill'
            ? `pill ${size === 'sm' ? 'pill-sm' : ''} ${className}`
            : `input flex items-center gap-2 text-left disabled:opacity-60 ${size === 'sm' ? 'h-7 text-xs' : ''} ${className}`}
        style={variant === 'pill' && !custom ? cvar(cur?.color) : undefined}
        onClick={(e) => { e.stopPropagation(); if (open) close(false); else show(); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
        }}>
        {variant === 'pill' && !custom
          ? <span className="pill-dot" aria-hidden />
          : cur?.color ? <span className="pill-dot" style={cvar(cur.color)} aria-hidden /> : null}
        <span className={`min-w-0 flex-1 truncate ${!cur && placeholder && variant === 'field' && !custom ? 'text-ink-2' : ''}`}>{shown}</span>
        <Icon name="chevronDown" size={12} className={variant === 'pill' || custom ? 'opacity-70' : 'text-ink-3'} />
      </button>
      <FloatingPanel anchor={btn} open={open} onClose={close} matchWidth role="presentation" className="min-w-[176px]">
        <ul ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={label}
          aria-activedescendant={`${id}-o${active}`} onKeyDown={onListKey} className="outline-none">
          {options.map((o, i) => (
            <li key={o.value} id={`${id}-o${i}`} data-i={i} role="option" aria-selected={o.value === value}
              className={`menu-item cursor-pointer ${i === active ? 'bg-surface-hover' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              {o.color ? <span className="pill-dot" style={cvar(o.color)} aria-hidden /> : anyColor ? <span className="w-2" aria-hidden /> : null}
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

/** Shorthand for a plain form dropdown: `field` variant, string options. */
export function Dropdown(props: Omit<Parameters<typeof PillSelect>[0], 'variant'>) {
  return <PillSelect variant="field" {...props} />;
}
