import type {
  DeviceCategory, FormFactor, DeviceStatus, PortKind, CableType, IpKind, ServiceKind, ServiceStatus, ProjectStatus, ProjectPriority,
  PortLayoutEntry,
} from './enums';

/** API response shapes (JSON: timestamps are ISO strings). */
export interface Stamps { created_at: string; updated_at: string }

export interface Rack extends Stamps { id: string; name: string; total_units: number; notes: string | null }

export interface DeviceTemplate extends Stamps {
  id: string; key: string; name: string; category: DeviceCategory; form_factor: FormFactor; height_u: number;
  width_fraction: number; port_layout: PortLayoutEntry[]; illustration_key: string; shelf_slots: number | null; is_builtin: boolean;
}

export interface Port extends Stamps {
  id: string; device_id: string; label: string; kind: PortKind; speed_mbps: number | null; poe: boolean;
  position_index: number; layout_x: number; layout_y: number; group: string | null;
}

export interface Device extends Stamps {
  id: string; name: string; hostname: string | null; template_id: string; rack_id: string | null; rack_unit_start: number | null;
  rack_side: 'front'; shelf_device_id: string | null; shelf_slot: number | null; role: string | null; os: string | null;
  location_note: string | null; status: DeviceStatus; tags: string[]; color_accent: string | null; ports: Port[];
}

export interface Link extends Stamps {
  id: string; port_a_id: string; port_b_id: string; cable_type: CableType; cable_color: string; length_m: number | null;
  label: string | null; notes: string | null; warnings?: { code: string; message: string }[];
}

export interface Warning { code: string; message: string }

export interface IpAddress extends Stamps {
  id: string; device_id: string; port_id: string | null; address: string; prefix_length: number; kind: IpKind; vlan_id: string | null;
  dns_name: string | null; is_primary: boolean; notes: string | null; device_name: string; vlan_number: number | null; warnings: Warning[];
}

export interface Vlan extends Stamps { id: string; vlan_number: number; name: string; subnet: string | null; notes: string | null }

export interface Service extends Stamps {
  id: string; device_id: string; parent_service_id: string | null; name: string; kind: ServiceKind; vmid_or_ctid: number | null;
  ip_address_id: string | null; port_number: number | null; url: string | null; status: ServiceStatus; notes: string | null; sort_order: number;
}
export interface ServiceNode extends Service { children: ServiceNode[] }

export interface Note extends Stamps {
  id: string; device_id: string | null; service_id: string | null; title: string; body_markdown: string; pinned: boolean;
}

export interface CredentialMeta {
  id: string; device_id: string | null; service_id: string | null; label: string; username_plain: string | null; url: string | null;
  has_totp: boolean; has_notes: boolean; last_revealed_at: string | null; created_at: string; updated_at: string;
}
export interface RevealedCredential { id: string; secret: string; totp_seed: string | null; private_notes: string | null }

export interface VaultStatus { configured: boolean; unlocked: boolean; auto_lock_ms: number; remaining_ms: number }

export interface ProjectLink {
  id: string; device_id: string | null; service_id: string | null; device_name: string | null; service_name: string | null; service_device_id: string | null;
}
export interface ProjectTask extends Stamps { id: string; project_id: string; text: string; done: boolean; sort_order: number }
export interface Project extends Stamps {
  id: string; title: string; description_markdown: string; status: ProjectStatus; priority: ProjectPriority; due_date: string | null;
  sort_order: number; tags: string[]; archived: boolean; completed_at: string | null;
  links: ProjectLink[]; tasks: ProjectTask[]; task_progress: { done: number; total: number };
}
export interface ProjectBadge { device_id: string; open_count: number }

export interface AuditEntry { id: number; at: string; action: string; entity_type: string; entity_id: string | null; summary: string }

export interface Settings {
  id: 1; vault_auto_lock_minutes: number; default_unit_height_px: number; reduced_motion: 'system' | 'reduce' | 'no-preference';
  seed_loaded: boolean; seed_present: boolean;
}
