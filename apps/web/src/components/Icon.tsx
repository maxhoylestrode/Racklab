import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck, Cable, Check, ChevronDown, ChevronRight, ChevronUp, Columns3, Contrast, Copy, Download, Ellipsis, ExternalLink,
  Eye, EyeOff, FileText, GripVertical, History, ImageDown, KeyRound, Link2, List, Lock, LockOpen, LogOut, Menu, Minus, Moon,
  Network, Pencil, Pin, Plus, Spline, Printer, Redo2, RotateCw, Search, Server, Settings, SquareKanban, Star, Sun, Trash2,
  TriangleAlert, Undo2, Upload, X, Router, Cpu, Laptop, Monitor, Rows3, HardDrive, BatteryCharging, Wifi, EthernetPort, Box,
} from 'lucide-react';

/** Name -> Lucide icon. One stroke width (1.5) and two sizes (16, 20) across the app. */
const ICONS = {
  rack: Server,
  topology: Network,
  docs: FileText,
  projects: SquareKanban,
  lock: Lock,
  unlock: LockOpen,
  sun: Sun,
  moon: Moon,
  menu: Menu,
  more: Ellipsis,
  plus: Plus,
  minus: Minus,
  search: Search,
  cable: Cable,
  cables: Spline,
  undo: Undo2,
  redo: Redo2,
  refresh: RotateCw,
  close: X,
  eye: Eye,
  eyeOff: EyeOff,
  copy: Copy,
  trash: Trash2,
  edit: Pencil,
  download: Download,
  upload: Upload,
  pin: Pin,
  link: Link2,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  grip: GripVertical,
  image: ImageDown,
  dim: Contrast,
  badge: BadgeCheck,
  list: List,
  board: Columns3,
  check: Check,
  warning: TriangleAlert,
  external: ExternalLink,
  print: Printer,
  key: KeyRound,
  star: Star,
  settings: Settings,
  logout: LogOut,
  history: History,
  router: Router,
  sbc: Cpu,
  laptop: Laptop,
  pc: Monitor,
  shelf: Rows3,
  nas: HardDrive,
  ups: BatteryCharging,
  ap: Wifi,
  switch: EthernetPort,
  device: Box,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Icon for a device template category (inventory rows, cards). */
export function categoryIcon(c: string | undefined): IconName {
  const m: Record<string, IconName> = { server: 'rack', switch: 'switch', router: 'router', sbc: 'sbc', laptop: 'laptop', pc: 'pc', shelf: 'shelf', nas: 'nas', ups: 'ups', ap: 'ap', patch_panel: 'cable' };
  return (c && m[c]) || 'device';
}

/** Sizes snap to the 16 / 20 grid: anything under 18 renders at 16. */
export function Icon({ name, size = 16, className = '', title }: { name: IconName; size?: number; className?: string; title?: string }) {
  const C = ICONS[name];
  const s = size >= 18 ? 20 : 16;
  return (
    <C size={s} strokeWidth={1.5} absoluteStrokeWidth className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} focusable={false} />
  );
}
