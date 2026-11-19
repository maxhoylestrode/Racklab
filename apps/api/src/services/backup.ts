import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { PORT_KINDS, CABLE_TYPES, DEVICE_STATUSES, IP_KINDS, SERVICE_KINDS, SERVICE_STATUSES, PROJECT_STATUS_KINDS, PROJECT_ICONS, DEVICE_CATEGORIES, FORM_FACTORS, portLayoutEntrySchema } from '@rackmap/shared';
import type { DB } from '../db/client';
import {
  racks, deviceTemplates, devices, ports, links, vlans, ipAddresses, services, notes, credentials, vaultMeta,
  projects, projectLinks, projectTasks, appSettings, projectStatuses, projectPriorities, projectTagColors,
} from '../db/schema';
import { badRequest } from '../errors';

export const EXPORT_FORMAT = 'rackmap-export';
export const EXPORT_VERSION = 1;

const b64 = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v);
const toJson = (rows: Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : b64(v)])));

/** Full JSON export. Secrets stay encrypted (ciphertext + nonce, base64); vault_meta holds only wrapped keys. */
export async function exportAll(db: DB) {
  const [r, t, d, p, l, v, ip, s, n, c, vm, pr, pl, pt, st, ps, pp, tc] = await Promise.all([
    db.select().from(racks), db.select().from(deviceTemplates), db.select().from(devices), db.select().from(ports),
    db.select().from(links), db.select().from(vlans), db.select().from(ipAddresses), db.select().from(services),
    db.select().from(notes), db.select().from(credentials), db.select().from(vaultMeta), db.select().from(projects),
    db.select().from(projectLinks), db.select().from(projectTasks), db.select().from(appSettings),
    db.select().from(projectStatuses), db.select().from(projectPriorities), db.select().from(projectTagColors),
  ]);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    data: {
      racks: toJson(r), device_templates: toJson(t), devices: toJson(d), ports: toJson(p), links: toJson(l), vlans: toJson(v),
      ip_addresses: toJson(ip).map((x) => ({ ...x, address: String(x.address).replace(/\/(32|128)$/, '') })),
      services: toJson(s), notes: toJson(n), credentials: toJson(c), vault_meta: toJson(vm), projects: toJson(pr),
      project_links: toJson(pl), project_tasks: toJson(pt), app_settings: toJson(st),
      project_statuses: toJson(ps), project_priorities: toJson(pp), project_tag_colors: toJson(tc),
    },
  };
}

// ---------- import validation ----------
const id = z.string().uuid();
const nid = id.nullable();
const ts = z.string().datetime({ offset: true }).optional();
const str = z.string().nullable().optional();
const b64s = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
const stamps = { created_at: ts, updated_at: ts };

const S = {
  racks: z.object({ id, name: z.string().min(1), total_units: z.number().int().min(1).max(60), notes: str, ...stamps }),
  device_templates: z.object({
    id, key: z.string().min(1), name: z.string().min(1), category: z.enum(DEVICE_CATEGORIES), form_factor: z.enum(FORM_FACTORS),
    height_u: z.number().int().min(1).max(8), width_fraction: z.number().gt(0).max(1), port_layout: z.array(portLayoutEntrySchema),
    illustration_key: z.string(), shelf_slots: z.number().int().nullable().optional(), is_builtin: z.boolean(), ...stamps,
  }),
  devices: z.object({
    id, name: z.string().min(1), hostname: str, template_id: id, rack_id: nid, rack_unit_start: z.number().int().nullable(),
    rack_side: z.literal('front').optional(), shelf_device_id: nid, shelf_slot: z.number().int().nullable(), role: str, os: str,
    location_note: str, status: z.enum(DEVICE_STATUSES), tags: z.array(z.string()), color_accent: str, ...stamps,
  }),
  ports: z.object({
    id, device_id: id, label: z.string(), kind: z.enum(PORT_KINDS), speed_mbps: z.number().int().nullable(), poe: z.boolean(),
    position_index: z.number().int(), layout_x: z.number(), layout_y: z.number(), group: str, ...stamps,
  }),
  links: z.object({
    id, port_a_id: id, port_b_id: id, cable_type: z.enum(CABLE_TYPES), cable_color: z.string(), length_m: z.number().nullable().optional(),
    label: str, notes: str, ...stamps,
  }),
  vlans: z.object({ id, vlan_number: z.number().int(), name: z.string(), subnet: str, notes: str, ...stamps }),
  ip_addresses: z.object({
    id, device_id: id, port_id: nid.optional(), address: z.string(), prefix_length: z.number().int(), kind: z.enum(IP_KINDS),
    vlan_id: nid.optional(), dns_name: str, is_primary: z.boolean(), notes: str, ...stamps,
  }),
  services: z.object({
    id, device_id: id, parent_service_id: nid.optional(), name: z.string(), kind: z.enum(SERVICE_KINDS), vmid_or_ctid: z.number().int().nullable().optional(),
    ip_address_id: nid.optional(), port_number: z.number().int().nullable().optional(), url: str, status: z.enum(SERVICE_STATUSES), notes: str,
    sort_order: z.number().int().optional(), ...stamps,
  }),
  notes: z.object({ id, device_id: nid.optional(), service_id: nid.optional(), title: z.string(), body_markdown: z.string(), pinned: z.boolean(), ...stamps }),
  credentials: z.object({
    id, device_id: nid.optional(), service_id: nid.optional(), label: z.string(), username_plain: str,
    secret_ciphertext: b64s, secret_nonce: b64s, totp_ciphertext: b64s.nullable().optional(), totp_nonce: b64s.nullable().optional(),
    url: str, notes_ciphertext: b64s.nullable().optional(), notes_nonce: b64s.nullable().optional(), last_revealed_at: z.string().nullable().optional(), ...stamps,
  }),
  vault_meta: z.object({
    id: z.literal(1), kdf_salt: b64s, kdf_params: z.any(), wrapped_data_key: b64s, wrapped_data_key_nonce: b64s, verifier: b64s, verifier_nonce: b64s,
    recovery_kdf_params: z.any(), recovery_wrapped_data_key: b64s, recovery_wrapped_data_key_nonce: b64s, ...stamps,
  }),
  projects: z.object({
    id, title: z.string().min(1).max(200), description_markdown: z.string(), status: z.string().min(1).max(40), priority: z.string().min(1).max(40),
    due_date: str, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), icon: z.enum(PROJECT_ICONS).nullable().optional(), sort_order: z.number().int(), tags: z.array(z.string()), archived: z.boolean().optional(), completed_at: z.string().nullable().optional(), ...stamps,
  }),
  project_links: z.object({ id, project_id: id, device_id: nid.optional(), service_id: nid.optional(), ...stamps }),
  project_tasks: z.object({ id, project_id: id, text: z.string(), done: z.boolean(), sort_order: z.number().int(), ...stamps }),
  project_statuses: z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(40), color: z.string(), kind: z.enum(PROJECT_STATUS_KINDS), sort_order: z.number().int(), ...stamps }),
  project_priorities: z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(40), color: z.string(), sort_order: z.number().int(), ...stamps }),
  project_tag_colors: z.object({ name: z.string().min(1).max(40), color: z.string(), ...stamps }),
  app_settings: z.object({ id: z.literal(1), vault_auto_lock_minutes: z.number().int(), default_unit_height_px: z.number().int(), reduced_motion: z.string(), ...stamps }),
};

export const importFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exported_at: z.string().optional(),
  data: z.object(Object.fromEntries(Object.entries(S).map(([k, v]) => [k, z.array(v).default([])])) as { [K in keyof typeof S]: z.ZodDefault<z.ZodArray<(typeof S)[K]>> }),
});
export type ImportFile = z.infer<typeof importFileSchema>;

/** Referential checks across the whole file before anything is written. */
function checkReferences(f: ImportFile, localBuiltins: Map<string, string>, local: { statuses: string[]; priorities: string[] }) {
  const d = f.data;
  const set = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
  const tplIds = set(d.device_templates), devIds = set(d.devices), portIds = set(d.ports), rackIds = set(d.racks);
  const svcIds = set(d.services), projIds = set(d.projects), vlanIds = set(d.vlans), ipIds = set(d.ip_addresses);
  const errs: string[] = [];
  const need = (ok: boolean, msg: string) => { if (!ok && errs.length < 50) errs.push(msg); };
  for (const t of d.device_templates) if (t.is_builtin) need(localBuiltins.has(t.key), `Unknown built-in template ${t.key}`);
  for (const x of d.devices) {
    need(tplIds.has(x.template_id), `Device ${x.name} has an unknown template`);
    need(!x.rack_id || rackIds.has(x.rack_id), `Device ${x.name} is in an unknown rack`);
    need(!x.shelf_device_id || devIds.has(x.shelf_device_id), `Device ${x.name} is on an unknown shelf`);
  }
  // Rack placement rules: inside the rack, no overlaps.
  const tplById = new Map(d.device_templates.map((t) => [t.id, t]));
  const rackById = new Map(d.racks.map((r) => [r.id, r]));
  const occupied = new Map<string, { lo: number; hi: number; name: string }[]>();
  for (const x of d.devices) {
    if (!x.rack_id || x.rack_unit_start == null) continue;
    const h = tplById.get(x.template_id)?.height_u ?? 1;
    const lo = x.rack_unit_start, hi = lo + h - 1;
    const rack = rackById.get(x.rack_id);
    need(!rack || (lo >= 1 && hi <= rack.total_units), `Device ${x.name} extends past its rack`);
    const list = occupied.get(x.rack_id) ?? [];
    const hit = list.find((o) => lo <= o.hi && o.lo <= hi);
    need(!hit, `Device ${x.name} overlaps ${hit?.name}`);
    list.push({ lo, hi, name: x.name });
    occupied.set(x.rack_id, list);
  }
  for (const x of d.ports) need(devIds.has(x.device_id), `Port ${x.label} belongs to an unknown device`);
  const used = new Set<string>();
  for (const x of d.links) {
    need(portIds.has(x.port_a_id) && portIds.has(x.port_b_id), `Link ${x.id} references an unknown port`);
    need(x.port_a_id !== x.port_b_id, `Link ${x.id} joins a port to itself`);
    for (const pid of [x.port_a_id, x.port_b_id]) { need(!used.has(pid), `Port ${pid} has more than one cable`); used.add(pid); }
  }
  for (const x of d.ip_addresses) {
    need(devIds.has(x.device_id), `IP ${x.address} belongs to an unknown device`);
    need(!x.vlan_id || vlanIds.has(x.vlan_id), `IP ${x.address} references an unknown VLAN`);
  }
  for (const x of d.services) {
    need(devIds.has(x.device_id), `Service ${x.name} belongs to an unknown device`);
    need(!x.parent_service_id || svcIds.has(x.parent_service_id), `Service ${x.name} has an unknown parent`);
    need(!x.ip_address_id || ipIds.has(x.ip_address_id), `Service ${x.name} references an unknown IP`);
  }
  for (const x of [...d.notes, ...d.credentials]) {
    need(!x.device_id || devIds.has(x.device_id), `Record ${x.id} references an unknown device`);
    need(!x.service_id || svcIds.has(x.service_id), `Record ${x.id} references an unknown service`);
  }
  need(d.credentials.length === 0 || d.vault_meta.length === 1, 'The file has credentials but no vault keys, so they could never be decrypted');
  for (const x of d.project_links) {
    need(projIds.has(x.project_id), 'A project link references an unknown project');
    need(!!x.device_id !== !!x.service_id, 'A project link must set exactly one of device or service');
    need(!x.device_id || devIds.has(x.device_id), 'A project link references an unknown device');
    need(!x.service_id || svcIds.has(x.service_id), 'A project link references an unknown service');
  }
  for (const x of d.project_tasks) need(projIds.has(x.project_id), 'A project task references an unknown project');
  // Exports from before custom statuses carry none: their projects must fit this install's statuses and priorities.
  const statusKeys = new Set(d.project_statuses.length ? d.project_statuses.map((x) => x.key) : local.statuses);
  const priorityKeys = new Set(d.project_priorities.length ? d.project_priorities.map((x) => x.key) : local.priorities);
  for (const x of d.projects) {
    need(statusKeys.has(x.status), `Project ${x.title} has an unknown status ${x.status}`);
    need(priorityKeys.has(x.priority), `Project ${x.title} has an unknown priority ${x.priority}`);
  }
  if (errs.length) throw badRequest('The import file is inconsistent', 'import_invalid', { errors: errs });
}

const unb64 = (s: string | null | undefined) => (s == null ? null : Buffer.from(s, 'base64'));
const date = (s: string | null | undefined) => (s == null ? undefined : new Date(s));

/**
 * Validates the whole file, then replaces all lab data in a single transaction.
 * Built-in templates are matched to this install's built-ins by key.
 */
export async function importAll(db: DB, raw: unknown) {
  const parsed = importFileSchema.safeParse(raw);
  if (!parsed.success) throw badRequest('The import file is not a valid RackMap export', 'import_invalid', parsed.error.flatten());
  const f = parsed.data;
  const builtins = await db.select({ id: deviceTemplates.id, key: deviceTemplates.key }).from(deviceTemplates).where(eq(deviceTemplates.is_builtin, true));
  const localBuiltins = new Map(builtins.map((b) => [b.key, b.id]));
  const [localStatuses, localPriorities] = await Promise.all([
    db.select({ key: projectStatuses.key }).from(projectStatuses), db.select({ key: projectPriorities.key }).from(projectPriorities),
  ]);
  checkReferences(f, localBuiltins, { statuses: localStatuses.map((x) => x.key), priorities: localPriorities.map((x) => x.key) });

  const tplMap = new Map<string, string>();
  for (const t of f.data.device_templates) tplMap.set(t.id, t.is_builtin ? localBuiltins.get(t.key)! : t.id);
  const d = f.data;
  const withDates = <T extends { created_at?: string; updated_at?: string }>(x: T) => ({ ...x, created_at: date(x.created_at), updated_at: date(x.updated_at) });

  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    // Order matters: children first on delete.
    for (const table of [projectTasks, projectLinks, projects, credentials, notes, services, ipAddresses, vlans, links, ports]) await t.delete(table);
    await t.update(devices).set({ shelf_device_id: null });
    await t.delete(devices);
    await t.delete(racks);
    await t.delete(deviceTemplates).where(eq(deviceTemplates.is_builtin, false));
    await t.delete(vaultMeta);

    const ins = async (table: any, rows: any[]) => { if (rows.length) await t.insert(table).values(rows); };
    await ins(racks, d.racks.map(withDates));
    await ins(deviceTemplates, d.device_templates.filter((x) => !x.is_builtin).map(withDates));
    const devRows = d.devices.map((x) => ({ ...withDates(x), template_id: tplMap.get(x.template_id)!, rack_side: 'front', shelf_device_id: null }));
    await ins(devices, devRows);
    for (const x of d.devices.filter((y) => y.shelf_device_id)) {
      await t.update(devices).set({ shelf_device_id: x.shelf_device_id }).where(eq(devices.id, x.id));
    }
    await ins(ports, d.ports.map(withDates));
    await ins(links, d.links.map(withDates));
    await ins(vlans, d.vlans.map(withDates));
    await ins(ipAddresses, d.ip_addresses.map(withDates));
    // Services: insert parents before children.
    const pending = [...d.services];
    const done = new Set<string>();
    while (pending.length) {
      const batch = pending.filter((s) => !s.parent_service_id || done.has(s.parent_service_id));
      if (!batch.length) throw badRequest('Service parents form a cycle', 'import_invalid');
      await ins(services, batch.map(withDates));
      batch.forEach((s) => { done.add(s.id); pending.splice(pending.indexOf(s), 1); });
    }
    await ins(notes, d.notes.map(withDates));
    await ins(vaultMeta, d.vault_meta.map((v) => ({
      ...withDates(v),
      kdf_salt: unb64(v.kdf_salt), wrapped_data_key: unb64(v.wrapped_data_key), wrapped_data_key_nonce: unb64(v.wrapped_data_key_nonce),
      verifier: unb64(v.verifier), verifier_nonce: unb64(v.verifier_nonce), recovery_wrapped_data_key: unb64(v.recovery_wrapped_data_key),
      recovery_wrapped_data_key_nonce: unb64(v.recovery_wrapped_data_key_nonce),
    })));
    await ins(credentials, d.credentials.map((c) => ({
      ...withDates(c),
      secret_ciphertext: unb64(c.secret_ciphertext), secret_nonce: unb64(c.secret_nonce),
      totp_ciphertext: unb64(c.totp_ciphertext), totp_nonce: unb64(c.totp_nonce),
      notes_ciphertext: unb64(c.notes_ciphertext), notes_nonce: unb64(c.notes_nonce),
      last_revealed_at: date(c.last_revealed_at) ?? null,
    })));
    if (d.project_statuses.length) {
      await t.delete(projectStatuses);
      await ins(projectStatuses, d.project_statuses.map(withDates));
      await t.delete(projectTagColors);
      await ins(projectTagColors, d.project_tag_colors.map(withDates));
    }
    if (d.project_priorities.length) {
      await t.delete(projectPriorities);
      await ins(projectPriorities, d.project_priorities.map(withDates));
    }
    await ins(projects, d.projects.map((p) => ({ ...withDates(p), completed_at: date(p.completed_at) ?? null })));
    await ins(projectLinks, d.project_links.map(withDates));
    await ins(projectTasks, d.project_tasks.map(withDates));
    if (d.app_settings[0]) {
      const s = d.app_settings[0];
      await t.update(appSettings).set({ vault_auto_lock_minutes: s.vault_auto_lock_minutes, default_unit_height_px: s.default_unit_height_px, reduced_motion: s.reduced_motion }).where(eq(appSettings.id, 1));
    }
  });

  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v as unknown[]).length]));
}
