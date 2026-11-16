export const DEVICE_CATEGORIES = ['router', 'switch', 'server', 'sbc', 'pc', 'laptop', 'nas', 'ap', 'ups', 'patch_panel', 'shelf', 'other'] as const;
export const FORM_FACTORS = ['rack', 'loose'] as const;
export const DEVICE_STATUSES = ['online', 'offline', 'unknown', 'planned'] as const;
export const PORT_KINDS = ['rj45', 'sfp', 'sfp_plus', 'usb', 'power', 'console', 'idrac', 'hdmi', 'vga', 'other'] as const;
export const CABLE_TYPES = ['cat5e', 'cat6', 'cat6a', 'fibre', 'dac', 'usb', 'power', 'other'] as const;
export const IP_KINDS = ['static', 'dhcp', 'reserved', 'virtual'] as const;
export const SERVICE_KINDS = ['vm', 'lxc', 'docker', 'app', 'other'] as const;
export const SERVICE_STATUSES = ['running', 'stopped', 'unknown', 'planned'] as const;
export const PROJECT_STATUSES = ['not_started', 'in_progress', 'complete'] as const;
export const PROJECT_PRIORITIES = ['low', 'medium', 'high'] as const;

export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];
export type FormFactor = (typeof FORM_FACTORS)[number];
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export type PortKind = (typeof PORT_KINDS)[number];
export type CableType = (typeof CABLE_TYPES)[number];
export type IpKind = (typeof IP_KINDS)[number];
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

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
