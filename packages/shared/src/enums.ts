export const DEVICE_CATEGORIES = ['router', 'switch', 'server', 'sbc', 'pc', 'laptop', 'nas', 'ap', 'ups', 'patch_panel', 'shelf', 'other'] as const;
export const FORM_FACTORS = ['rack', 'loose'] as const;
export const DEVICE_STATUSES = ['online', 'offline', 'unknown', 'planned'] as const;
export const PORT_KINDS = ['rj45', 'sfp', 'sfp_plus', 'usb', 'power', 'console', 'idrac', 'hdmi', 'vga', 'other'] as const;
export const CABLE_TYPES = ['cat5e', 'cat6', 'cat6a', 'fibre', 'dac', 'usb', 'power', 'other'] as const;
export const IP_KINDS = ['static', 'dhcp', 'reserved', 'virtual'] as const;
export const SERVICE_KINDS = ['vm', 'lxc', 'docker', 'app', 'other'] as const;
export const SERVICE_STATUSES = ['running', 'stopped', 'unknown', 'planned'] as const;
/**
 * Project statuses and priorities are user-defined rows (project_statuses / project_priorities).
 * Every status has a kind, which drives behaviour: 'done' sets completed_at, stops a project counting as
 * open or overdue, and collapses its board column by default.
 */
export const PROJECT_STATUS_KINDS = ['todo', 'active', 'done'] as const;
/** Icons a project can carry on its card (names in the web app's icon map). */
export const PROJECT_ICONS = [
  'wrench', 'hammer', 'rocket', 'shield', 'database', 'cloud', 'globe', 'terminal', 'code', 'bug', 'zap', 'flask',
  'package', 'book', 'home', 'camera', 'film', 'music', 'gamepad', 'rack', 'switch', 'router', 'nas', 'ap', 'sbc', 'ups', 'key', 'star',
] as const;

export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];
export type FormFactor = (typeof FORM_FACTORS)[number];
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export type PortKind = (typeof PORT_KINDS)[number];
export type CableType = (typeof CABLE_TYPES)[number];
export type IpKind = (typeof IP_KINDS)[number];
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
/** Key of a row in project_statuses (built-ins: not_started, in_progress, complete). */
export type ProjectStatus = string;
/** Key of a row in project_priorities (built-ins: low, medium, high). */
export type ProjectPriority = string;
export type ProjectStatusKind = (typeof PROJECT_STATUS_KINDS)[number];
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

/** One entry of a template's port_layout (spec 4.2). x is 0..1000, y is 0..height_u*100. */
export interface PortLayoutEntry {
  label: string;
  kind: PortKind;
  speed_mbps: number | null;
  poe: boolean;
  x: number;
  y: number;
  group?: string;
  uplink?: boolean;
}
