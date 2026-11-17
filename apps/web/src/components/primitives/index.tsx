/**
 * UI primitives. Each one renders the token-backed recipe from index.css (glass, btn-*, input, chip, table-base),
 * so screens compose these instead of styling ad hoc.
 */
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion';
import { Icon, type IconName } from '../Icon';

const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

/** Shared motion: 240ms ease-out, 12px slide plus fade, for drawers and dialogs. */
export const PANEL_EASE = [0.2, 0.8, 0.2, 1] as const;
export const panelTransition = { duration: 0.24, ease: PANEL_EASE };

// ---------------------------------------------------------------- Panel
export type Elevation = 'base' | 'raised' | 'overlay' | 'solid' | 'vault';
export function panelClass(elevation: Elevation = 'base') {
  switch (elevation) {
    case 'raised': return 'glass glass-raised rounded-panel';
    case 'overlay': return 'glass glass-overlay rounded-panel';
    case 'vault': return 'glass glass-vault rounded-panel';
    case 'solid': return 'surface-solid rounded-panel';
    default: return 'glass rounded-panel';
  }
}
export function Panel({ elevation = 'base', className, as: As = 'div', ...rest }: HTMLAttributes<HTMLElement> & { elevation?: Elevation; as?: 'div' | 'section' | 'aside' | 'header' | 'nav' }) {
  return <As className={cx(panelClass(elevation), className)} {...rest} />;
}

// ---------------------------------------------------------------- Button
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  /** Toggle buttons: shows the pressed state and sets aria-pressed. */
  pressed?: boolean;
}
export function buttonClass({ variant = 'secondary', size = 'md', pressed, iconOnly }: { variant?: ButtonVariant; size?: 'sm' | 'md'; pressed?: boolean; iconOnly?: boolean }) {
  return cx('btn', variant !== 'secondary' && `btn-${variant}`, size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', pressed && 'btn-on');
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size, icon, pressed, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-pressed={pressed} className={cx(buttonClass({ variant, size, pressed, iconOnly: !children }), className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
});

/** Icon-only button with a required accessible label and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string; tooltip?: string }>(
  function IconButton({ icon, label, tooltip, variant = 'ghost', size = 'sm', ...rest }, ref) {
    return (
      <Tooltip content={tooltip ?? label}>
        <Button ref={ref} variant={variant} size={size} icon={icon} aria-label={label} {...rest} />
      </Tooltip>
    );
  },
);

// ---------------------------------------------------------------- Fields
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('input', className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx('input', className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('input', className)} {...rest} />;
});
/** Search input with a leading icon. */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }>(function SearchInput({ className, wrapperClassName, ...rest }, ref) {
  return (
    <div className={cx('relative', wrapperClassName)}>
      <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
      <input ref={ref} type="search" className={cx('input pl-8', className)} {...rest} />
    </div>
  );
});
export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-2">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Chip
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';
export const chipClass = (tone: Tone = 'neutral') => cx('chip', tone !== 'neutral' && `chip-${tone}`);
export function Chip({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cx(chipClass(tone), className)} {...rest} />;
}

// ---------------------------------------------------------------- Tooltip
/**
 * Hover/focus tooltip, portalled to <body> with fixed positioning so scroll containers never clip it.
 * Solid (no blur) so it never adds a backdrop layer.
 */
export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const t = useRef<number>();
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => () => window.clearTimeout(t.current), []);
  const show = () => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const up = side === 'top' || r.bottom + 40 > window.innerHeight;
      setPos({ x: Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80), y: up ? r.top - 8 : r.bottom + 8, up });
    }, 350);
  };
  const hide = () => { window.clearTimeout(t.current); setPos(null); };
  return (
    <span ref={anchor} className="inline-flex" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} onFocus={show} onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()} aria-describedby={pos ? id : undefined}>
      {children}
      {pos && createPortal(
        <span role="tooltip" id={id} style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.up ? '-100%' : '0'})` }}
          className="pointer-events-none fixed z-toast whitespace-nowrap rounded-control border border-line-strong bg-surface-raised px-2 py-1 text-xs font-medium text-ink shadow-raised">
          {content}
        </span>,
        // Inside <main> when present, so the tooltip stays within a landmark.
        document.getElementById('main') ?? document.body,
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix, className, render }: {
  tabs: readonly T[]; value: T; onChange: (t: T) => void; label: string; idPrefix: string; className?: string; render?: (t: T) => ReactNode;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.indexOf(value);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    onChange(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cx('flex items-end gap-4 overflow-x-auto', className)} onKeyDown={onKey}>
      {tabs.map((t) => {
        const on = t === value;
        return (
          <button key={t} id={`${idPrefix}-tab-${t}`} role="tab" type="button" aria-selected={on} aria-controls={`${idPrefix}-panel`} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t)}
            className={cx('relative -mb-px h-10 shrink-0 border-b-2 text-sm transition-colors duration-fast',
              on ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
            {render ? render(t) : t}
          </button>
        );
      })}
    </div>
  );
}
export function TabPanel({ idPrefix, value, className, children }: { idPrefix: string; value: string; className?: string; children: ReactNode }) {
  return <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${value}`} className={className}>{children}</div>;
}

// ---------------------------------------------------------------- Table
/** Data table on a solid surface (no blur behind rows). */
export function Table({ children, className, compact, wrapperClassName }: { children: ReactNode; className?: string; compact?: boolean; wrapperClassName?: string }) {
  return (
    <div className={cx('surface-solid overflow-x-auto rounded-panel', wrapperClassName)}>
      <table className={cx('table-base', compact && 'table-compact', className)}>{children}</table>
    </div>
  );
}

// ---------------------------------------------------------------- Dialog
export function Dialog({ open, onClose, title, description, children, width = 'max-w-md', labelledBy }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; width?: string; labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button');
      el?.focus();
    }, 20);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  const titleId = labelledBy ?? `modal-${title.replace(/\W+/g, '-')}`;
  return (
    <AnimatePresence>
      {open && (
        // The scrim dims without blurring, so a dialog over a drawer stays within the backdrop-layer budget.
        <motion.div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: PANEL_EASE }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={`glass glass-overlay w-full ${width} max-h-[90vh] overflow-y-auto rounded-panel p-6`}
            initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={panelTransition}>
            <h2 id={titleId} className="text-md font-medium text-ink">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
/** Right-aligned action row for dialogs and forms. */
export function Actions({ children, className, between }: { children: ReactNode; className?: string; between?: boolean }) {
  return <div className={cx('mt-6 flex items-center gap-2', between ? 'justify-between' : 'justify-end', className)}>{children}</div>;
}

// ---------------------------------------------------------------- Drawer
/** Right-hand glass drawer. Slides 12px and fades over 240ms. */
export function Drawer({ label, className, children, ...rest }: Omit<HTMLMotionProps<'aside'>, 'children'> & { label: string; children: ReactNode }) {
  return (
    <motion.aside
      aria-label={label}
      className={cx('glass glass-raised flex flex-col overflow-hidden rounded-panel', className)}
      initial={{ x: 12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 12, opacity: 0 }} transition={panelTransition}
      {...rest}
    >
      {children}
    </motion.aside>
  );
}
export function DrawerHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={cx('flex items-start gap-2 border-b border-line px-4 py-3', className)}>{children}</header>;
}

// ---------------------------------------------------------------- Section heading inside panels
export function SectionHeader({ title, id, action, className }: { title: ReactNode; id?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-2 flex min-h-8 items-center justify-between gap-2', className)}>
      <h3 id={id} className="text-sm font-medium text-ink">{title}</h3>
      {action}
    </div>
  );
}

/** Short, specific empty state. Left aligned, no illustration. */
export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-panel border border-dashed border-line-strong px-4 py-4', className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-prose text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
