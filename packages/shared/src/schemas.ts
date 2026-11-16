import { z } from 'zod';
import {
  DEVICE_CATEGORIES, FORM_FACTORS, DEVICE_STATUSES, PORT_KINDS, CABLE_TYPES, IP_KINDS, SERVICE_KINDS, SERVICE_STATUSES,
  PROJECT_STATUSES, PROJECT_PRIORITIES,
} from './enums';

// ---------- primitives ----------
export const uuid = z.string().uuid();
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour like #3b82f6');
const optText = (max = 2000) => z.string().max(max).nullable().optional();
const tags = z.array(z.string().trim().min(1).max(40)).max(30);

// ---------- auth ----------
export const APP_PASSWORD_MIN = 12;
export const VAULT_PASSWORD_MIN = 14;
export const setupSchema = z.object({ password: z.string().min(APP_PASSWORD_MIN).max(1024) });
export const loginSchema = z.object({ password: z.string().min(1).max(1024) });
export const changeAppPasswordSchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: z.string().min(APP_PASSWORD_MIN).max(1024),
});

// ---------- vault ----------
export const vaultSetupSchema = z.object({ master_password: z.string().min(VAULT_PASSWORD_MIN).max(1024) });
export const vaultUnlockSchema = z.union([
  z.object({ master_password: z.string().min(1).max(1024) }),
  z.object({ recovery_phrase: z.string().min(1).max(1024) }),
]);
export const vaultChangePasswordSchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: z.string().min(VAULT_PASSWORD_MIN).max(1024),
});

// ---------- port layout ----------
export const portLayoutEntrySchema = z.object({
  label: z.string().min(1).max(40),
  kind: z.enum(PORT_KINDS),
  speed_mbps: z.number().int().positive().nullable(),
  poe: z.boolean(),
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(800),
  group: z.string().max(40).optional(),
  uplink: z.boolean().optional(),
});

// ---------- racks ----------
export const rackCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  total_units: z.number().int().min(1).max(60).default(42),
  notes: optText(),
});
export const rackUpdateSchema = rackCreateSchema.partial();

// ---------- templates ----------
export const templateCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,60}$/, 'Lowercase letters, digits and underscores').optional(),
  name: z.string().trim().min(1).max(100),
  category: z.enum(DEVICE_CATEGORIES),
  form_factor: z.enum(FORM_FACTORS),
  height_u: z.number().int().min(1).max(8),
  width_fraction: z.number().gt(0).max(1).default(1),
  port_layout: z.array(portLayoutEntrySchema).max(96).default([]),
  illustration_key: z.string().max(40).default('generic'),
  shelf_slots: z.number().int().min(1).max(8).nullable().optional(),
});
export const templateUpdateSchema = templateCreateSchema.omit({ key: true }).partial();

// ---------- devices ----------
export const placementSchema = z.object({
  rack_id: uuid.nullable().optional(),
  rack_unit_start: z.number().int().min(1).nullable().optional(),
  shelf_device_id: uuid.nullable().optional(),
  shelf_slot: z.number().int().min(1).nullable().optional(),
});
export const deviceCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  hostname: optText(253),
  template_id: uuid,
  role: optText(100),
  os: optText(100),
  location_note: optText(500),
  status: z.enum(DEVICE_STATUSES).default('unknown'),
  tags: tags.default([]),
  color_accent: hexColor.nullable().optional(),
}).merge(placementSchema);
export const deviceUpdateSchema = deviceCreateSchema.partial();
export const deviceMoveSchema = placementSchema;

// ---------- ports ----------
export const portUpdateSchema = z.object({
  label: z.string().trim().min(1).max(40),
  kind: z.enum(PORT_KINDS),
  speed_mbps: z.number().int().positive().nullable(),
  poe: z.boolean(),
  layout_x: z.number().min(0).max(1000),
  layout_y: z.number().min(0).max(800),
}).partial();

// ---------- links ----------
export const linkCreateSchema = z.object({
  port_a_id: uuid,
  port_b_id: uuid,
  cable_type: z.enum(CABLE_TYPES).default('cat6'),
  cable_color: hexColor.default('#3b82f6'),
  length_m: z.number().positive().max(1000).nullable().optional(),
  label: optText(100),
  notes: optText(),
});
export const linkUpdateSchema = linkCreateSchema.omit({ port_a_id: true, port_b_id: true }).partial();

// ---------- IPs and VLANs ----------
const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const ipAddressString = z.string().refine((s) => ipv4.test(s) || (s.includes(':') && /^[0-9a-fA-F:.]+$/.test(s)), 'Not a valid IP address');
export const cidrString = z.string().refine((s) => {
  const [addr, len] = s.split('/');
  if (!addr || len === undefined) return false;
  const n = Number(len);
  return ipv4.test(addr) ? Number.isInteger(n) && n >= 0 && n <= 32 : addr.includes(':') && Number.isInteger(n) && n >= 0 && n <= 128;
}, 'Not a valid CIDR such as 192.168.1.0/24');

export const ipCreateSchema = z.object({
  device_id: uuid,
  port_id: uuid.nullable().optional(),
  address: ipAddressString,
  prefix_length: z.number().int().min(0).max(128).default(24),
  kind: z.enum(IP_KINDS).default('static'),
  vlan_id: uuid.nullable().optional(),
  dns_name: optText(253),
  is_primary: z.boolean().default(false),
  notes: optText(),
});
export const ipUpdateSchema = ipCreateSchema.partial();

export const vlanCreateSchema = z.object({
  vlan_number: z.number().int().min(1).max(4094),
  name: z.string().trim().min(1).max(100),
  subnet: cidrString.nullable().optional(),
  notes: optText(),
});
export const vlanUpdateSchema = vlanCreateSchema.partial();

// ---------- services ----------
export const serviceCreateSchema = z.object({
  device_id: uuid,
  parent_service_id: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(SERVICE_KINDS),
  vmid_or_ctid: z.number().int().min(0).max(999999999).nullable().optional(),
  ip_address_id: uuid.nullable().optional(),
  port_number: z.number().int().min(1).max(65535).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  status: z.enum(SERVICE_STATUSES).default('unknown'),
  notes: optText(),
  sort_order: z.number().int().optional(),
});
export const serviceUpdateSchema = serviceCreateSchema.partial();

// ---------- notes ----------
export const noteCreateSchema = z.object({
  device_id: uuid.nullable().optional(),
  service_id: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  body_markdown: z.string().max(200_000).default(''),
  pinned: z.boolean().default(false),
}).refine((n) => !(n.device_id && n.service_id), 'A note belongs to a device or a service, not both');
export const noteUpdateSchema = z.object({
  device_id: uuid.nullable().optional(),
  service_id: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body_markdown: z.string().max(200_000).optional(),
  pinned: z.boolean().optional(),
});

// ---------- credentials ----------
export const credentialCreateSchema = z.object({
  device_id: uuid.nullable().optional(),
  service_id: uuid.nullable().optional(),
  label: z.string().trim().min(1).max(200),
  username_plain: optText(200),
  secret: z.string().min(1).max(10_000),
  totp_seed: z.string().trim().regex(/^[A-Z2-7 =]+$/i, 'TOTP seed must be base32').max(200).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  private_notes: z.string().max(20_000).nullable().optional(),
}).refine((c) => !(c.device_id && c.service_id), 'A credential belongs to a device or a service, not both');
export const credentialUpdateSchema = z.object({
  device_id: uuid.nullable().optional(),
  service_id: uuid.nullable().optional(),
  label: z.string().trim().min(1).max(200).optional(),
  username_plain: optText(200),
  secret: z.string().min(1).max(10_000).optional(),
  totp_seed: z.string().trim().regex(/^[A-Z2-7 =]+$/i, 'TOTP seed must be base32').max(200).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  private_notes: z.string().max(20_000).nullable().optional(),
});

// ---------- projects ----------
export const PROJECT_TITLE_MAX = 200;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const projectLinkInputSchema = z.union([
  z.object({ device_id: uuid, service_id: z.undefined().optional() }),
  z.object({ service_id: uuid, device_id: z.undefined().optional() }),
]);
export const projectCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(PROJECT_TITLE_MAX),
  description_markdown: z.string().max(100_000).default(''),
  status: z.enum(PROJECT_STATUSES).default('not_started'),
  priority: z.enum(PROJECT_PRIORITIES).default('medium'),
  due_date: isoDate.nullable().optional(),
  tags: tags.default([]),
  links: z.array(projectLinkInputSchema).max(50).default([]),
});
export const projectUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(PROJECT_TITLE_MAX),
  description_markdown: z.string().max(100_000),
  status: z.enum(PROJECT_STATUSES),
  priority: z.enum(PROJECT_PRIORITIES),
  due_date: isoDate.nullable(),
  tags,
  archived: z.boolean(),
}).partial();
export const projectMoveSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
  sort_order: z.number().int().min(0),
});
export const projectTaskCreateSchema = z.object({ text: z.string().trim().min(1).max(500), done: z.boolean().default(false), sort_order: z.number().int().optional() });
export const projectTaskUpdateSchema = z.object({ text: z.string().trim().min(1).max(500), done: z.boolean(), sort_order: z.number().int() }).partial();

// ---------- settings ----------
export const settingsUpdateSchema = z.object({
  vault_auto_lock_minutes: z.number().int().min(1).max(10),
  default_unit_height_px: z.number().int().min(28).max(80),
  reduced_motion: z.enum(['system', 'reduce', 'no-preference']),
}).partial();

export type SetupInput = z.infer<typeof setupSchema>;
export type RackCreate = z.infer<typeof rackCreateSchema>;
export type TemplateCreate = z.infer<typeof templateCreateSchema>;
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;
export type DeviceMove = z.infer<typeof deviceMoveSchema>;
export type LinkCreate = z.infer<typeof linkCreateSchema>;
export type IpCreate = z.infer<typeof ipCreateSchema>;
export type VlanCreate = z.infer<typeof vlanCreateSchema>;
export type ServiceCreate = z.infer<typeof serviceCreateSchema>;
export type NoteCreate = z.infer<typeof noteCreateSchema>;
export type CredentialCreate = z.infer<typeof credentialCreateSchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectMove = z.infer<typeof projectMoveSchema>;
