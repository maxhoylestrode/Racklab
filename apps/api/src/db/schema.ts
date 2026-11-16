import {
  pgTable, pgEnum, uuid, text, integer, boolean, real, timestamp, jsonb, inet, cidr, index, uniqueIndex, check, bigint, customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  DEVICE_CATEGORIES, FORM_FACTORS, DEVICE_STATUSES, PORT_KINDS, CABLE_TYPES, IP_KINDS, SERVICE_KINDS, SERVICE_STATUSES,
  PROJECT_STATUSES, PROJECT_PRIORITIES, type PortLayoutEntry,
} from '@rackmap/shared';
import type { KdfParams } from '../crypto/vault';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

export const deviceCategory = pgEnum('device_category', DEVICE_CATEGORIES);
export const formFactor = pgEnum('form_factor', FORM_FACTORS);
export const deviceStatus = pgEnum('device_status', DEVICE_STATUSES);
export const portKind = pgEnum('port_kind', PORT_KINDS);
export const cableType = pgEnum('cable_type', CABLE_TYPES);
export const ipKind = pgEnum('ip_kind', IP_KINDS);
export const serviceKind = pgEnum('service_kind', SERVICE_KINDS);
export const serviceStatus = pgEnum('service_status', SERVICE_STATUSES);
export const projectStatus = pgEnum('project_status', PROJECT_STATUSES);
export const projectPriority = pgEnum('project_priority', PROJECT_PRIORITIES);

const id = () => uuid('id').primaryKey().defaultRandom();
const stamps = () => ({
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const racks = pgTable('racks', {
  id: id(),
  name: text('name').notNull(),
  total_units: integer('total_units').notNull().default(42),
  notes: text('notes'),
  ...stamps(),
}, (t) => [check('racks_units_ck', sql`${t.total_units} between 1 and 60`)]);

export const deviceTemplates = pgTable('device_templates', {
  id: id(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  category: deviceCategory('category').notNull(),
  form_factor: formFactor('form_factor').notNull(),
  height_u: integer('height_u').notNull(),
  width_fraction: real('width_fraction').notNull().default(1),
  port_layout: jsonb('port_layout').$type<PortLayoutEntry[]>().notNull().default([]),
  illustration_key: text('illustration_key').notNull().default('generic'),
  /** Shelves only: how many numbered slots the shelf has. */
  shelf_slots: integer('shelf_slots'),
  is_builtin: boolean('is_builtin').notNull().default(false),
  ...stamps(),
}, (t) => [
  uniqueIndex('device_templates_key_uq').on(t.key),
  check('device_templates_height_ck', sql`${t.height_u} between 1 and 8`),
  check('device_templates_width_ck', sql`${t.width_fraction} > 0 and ${t.width_fraction} <= 1`),
]);

export const devices = pgTable('devices', {
  id: id(),
  name: text('name').notNull(),
  hostname: text('hostname'),
  template_id: uuid('template_id').notNull().references(() => deviceTemplates.id, { onDelete: 'restrict' }),
  rack_id: uuid('rack_id').references(() => racks.id, { onDelete: 'set null' }),
  rack_unit_start: integer('rack_unit_start'),
  rack_side: text('rack_side').notNull().default('front'),
  shelf_device_id: uuid('shelf_device_id').references((): any => devices.id, { onDelete: 'set null' }),
  shelf_slot: integer('shelf_slot'),
  role: text('role'),
  os: text('os'),
  location_note: text('location_note'),
  status: deviceStatus('status').notNull().default('unknown'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  color_accent: text('color_accent'),
  ...stamps(),
}, (t) => [
  index('devices_rack_idx').on(t.rack_id),
  uniqueIndex('devices_shelf_slot_uq').on(t.shelf_device_id, t.shelf_slot),
  check('devices_side_ck', sql`${t.rack_side} = 'front'`),
  check('devices_accent_ck', sql`${t.color_accent} is null or ${t.color_accent} ~ '^#[0-9a-fA-F]{6}$'`),
]);

export const ports = pgTable('ports', {
  id: id(),
  device_id: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  kind: portKind('kind').notNull(),
  speed_mbps: integer('speed_mbps'),
  poe: boolean('poe').notNull().default(false),
  position_index: integer('position_index').notNull(),
  layout_x: real('layout_x').notNull(),
  layout_y: real('layout_y').notNull(),
  group: text('group'),
  ...stamps(),
}, (t) => [index('ports_device_idx').on(t.device_id)]);

export const links = pgTable('links', {
  id: id(),
  port_a_id: uuid('port_a_id').notNull().references(() => ports.id, { onDelete: 'cascade' }),
  port_b_id: uuid('port_b_id').notNull().references(() => ports.id, { onDelete: 'cascade' }),
  cable_type: cableType('cable_type').notNull().default('cat6'),
  cable_color: text('cable_color').notNull().default('#3b82f6'),
  length_m: real('length_m'),
  label: text('label'),
  notes: text('notes'),
  ...stamps(),
}, (t) => [
  uniqueIndex('links_port_a_uq').on(t.port_a_id),
  uniqueIndex('links_port_b_uq').on(t.port_b_id),
  check('links_not_self_ck', sql`${t.port_a_id} <> ${t.port_b_id}`),
]);

export const vlans = pgTable('vlans', {
  id: id(),
  vlan_number: integer('vlan_number').notNull(),
  name: text('name').notNull(),
  subnet: cidr('subnet'),
  notes: text('notes'),
  ...stamps(),
}, (t) => [
  uniqueIndex('vlans_number_uq').on(t.vlan_number),
  check('vlans_number_ck', sql`${t.vlan_number} between 1 and 4094`),
]);

export const ipAddresses = pgTable('ip_addresses', {
  id: id(),
  device_id: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  port_id: uuid('port_id').references(() => ports.id, { onDelete: 'set null' }),
  address: inet('address').notNull(),
  prefix_length: integer('prefix_length').notNull().default(24),
  kind: ipKind('kind').notNull().default('static'),
  vlan_id: uuid('vlan_id').references(() => vlans.id, { onDelete: 'set null' }),
  dns_name: text('dns_name'),
  is_primary: boolean('is_primary').notNull().default(false),
  notes: text('notes'),
  ...stamps(),
}, (t) => [index('ip_addresses_device_idx').on(t.device_id)]);

export const services = pgTable('services', {
  id: id(),
  device_id: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  parent_service_id: uuid('parent_service_id').references((): any => services.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: serviceKind('kind').notNull(),
  vmid_or_ctid: integer('vmid_or_ctid'),
  ip_address_id: uuid('ip_address_id').references(() => ipAddresses.id, { onDelete: 'set null' }),
  port_number: integer('port_number'),
  url: text('url'),
  status: serviceStatus('status').notNull().default('unknown'),
  notes: text('notes'),
  sort_order: integer('sort_order').notNull().default(0),
  ...stamps(),
}, (t) => [index('services_device_idx').on(t.device_id)]);

export const notes = pgTable('notes', {
  id: id(),
  device_id: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
  service_id: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body_markdown: text('body_markdown').notNull().default(''),
  pinned: boolean('pinned').notNull().default(false),
  ...stamps(),
}, (t) => [check('notes_owner_ck', sql`not (${t.device_id} is not null and ${t.service_id} is not null)`)]);

export const credentials = pgTable('credentials', {
  id: id(),
  device_id: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
  service_id: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  username_plain: text('username_plain'),
  secret_ciphertext: bytea('secret_ciphertext').notNull(),
  secret_nonce: bytea('secret_nonce').notNull(),
  totp_ciphertext: bytea('totp_ciphertext'),
  totp_nonce: bytea('totp_nonce'),
  url: text('url'),
  notes_ciphertext: bytea('notes_ciphertext'),
  notes_nonce: bytea('notes_nonce'),
  last_revealed_at: timestamp('last_revealed_at', { withTimezone: true }),
  ...stamps(),
}, (t) => [check('credentials_owner_ck', sql`not (${t.device_id} is not null and ${t.service_id} is not null)`)]);

/** KDF params stored in vault_meta (salt is also kept base64 inside, per spec 6). */
export type { KdfParams } from '../crypto/vault';

export const vaultMeta = pgTable('vault_meta', {
  id: integer('id').primaryKey().default(1),
  kdf_salt: bytea('kdf_salt').notNull(),
  kdf_params: jsonb('kdf_params').$type<KdfParams>().notNull(),
  wrapped_data_key: bytea('wrapped_data_key').notNull(),
  wrapped_data_key_nonce: bytea('wrapped_data_key_nonce').notNull(),
  verifier: bytea('verifier').notNull(),
  verifier_nonce: bytea('verifier_nonce').notNull(),
  recovery_kdf_params: jsonb('recovery_kdf_params').$type<KdfParams>().notNull(),
  recovery_wrapped_data_key: bytea('recovery_wrapped_data_key').notNull(),
  recovery_wrapped_data_key_nonce: bytea('recovery_wrapped_data_key_nonce').notNull(),
  ...stamps(),
}, (t) => [check('vault_meta_single_ck', sql`${t.id} = 1`)]);

export const appUser = pgTable('app_user', {
  id: integer('id').primaryKey().default(1),
  password_hash: text('password_hash').notNull(),
  ...stamps(),
}, (t) => [check('app_user_single_ck', sql`${t.id} = 1`)]);

export const sessions = pgTable('sessions', {
  /** sha256 of the session token; the raw token only lives in the cookie. */
  id: text('id').primaryKey(),
  csrf_token: text('csrf_token').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  absolute_expires_at: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
});

export const loginAttempts = pgTable('login_attempts', {
  ip: text('ip').primaryKey(),
  failures: integer('failures').notNull().default(0),
  window_started_at: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  locked_until: timestamp('locked_until', { withTimezone: true }),
});

export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey().default(1),
  vault_auto_lock_minutes: integer('vault_auto_lock_minutes').notNull().default(10),
  default_unit_height_px: integer('default_unit_height_px').notNull().default(44),
  reduced_motion: text('reduced_motion').notNull().default('system'),
  ...stamps(),
}, (t) => [
  check('app_settings_single_ck', sql`${t.id} = 1`),
  check('app_settings_lock_ck', sql`${t.vault_auto_lock_minutes} between 1 and 10`),
  check('app_settings_unit_ck', sql`${t.default_unit_height_px} between 28 and 80`),
]);

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  summary: text('summary').notNull().default(''),
}, (t) => [index('audit_log_at_idx').on(t.at)]);

export const projects = pgTable('projects', {
  id: id(),
  title: text('title').notNull(),
  description_markdown: text('description_markdown').notNull().default(''),
  status: projectStatus('status').notNull().default('not_started'),
  priority: projectPriority('priority').notNull().default('medium'),
  /** ISO date (YYYY-MM-DD) */
  due_date: text('due_date'),
  sort_order: integer('sort_order').notNull().default(0),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  archived: boolean('archived').notNull().default(false),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  ...stamps(),
}, (t) => [
  check('projects_title_ck', sql`char_length(${t.title}) between 1 and 200`),
  index('projects_status_idx').on(t.status, t.sort_order),
]);

export const projectLinks = pgTable('project_links', {
  id: id(),
  project_id: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  device_id: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
  service_id: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
  ...stamps(),
}, (t) => [
  check('project_links_one_ck', sql`(${t.device_id} is null) <> (${t.service_id} is null)`),
  index('project_links_project_idx').on(t.project_id),
]);

export const projectTasks = pgTable('project_tasks', {
  id: id(),
  project_id: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  sort_order: integer('sort_order').notNull().default(0),
  ...stamps(),
}, (t) => [index('project_tasks_project_idx').on(t.project_id)]);
