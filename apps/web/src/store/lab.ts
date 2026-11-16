import { create } from 'zustand';
import type { Device, DeviceTemplate, Link, Rack, ProjectBadge, Port, DeviceStatus, CableType } from '@rackmap/shared';
import { api } from '../lib/api';

export interface Placement {
  rack_id: string | null;
  rack_unit_start: number | null;
  shelf_device_id: string | null;
  shelf_slot: number | null;
}
export const UNPLACED: Placement = { rack_id: null, rack_unit_start: null, shelf_device_id: null, shelf_slot: null };
export const placementOf = (d: Device): Placement => ({
  rack_id: d.rack_id, rack_unit_start: d.rack_unit_start, shelf_device_id: d.shelf_device_id, shelf_slot: d.shelf_slot,
});

/** One undoable step. Both directions go through the API. */
interface Step { label: string; undo: () => Promise<void>; redo: () => Promise<void> }
const HISTORY_LIMIT = 100;

type Selection = { kind: 'device'; id: string } | { kind: 'link'; id: string } | null;

interface LabState {
  loaded: boolean;
  racks: Rack[];
  templates: DeviceTemplate[];
  devices: Device[];
  links: Link[];
  badges: Record<string, number>;
  rackId: string | null;
  selection: Selection;
  past: Step[];
  future: Step[];
  /** old id -> current id, so history survives delete + undo (which re-creates rows with new ids). */
  alias: Record<string, string>;

  load: () => Promise<void>;
  refreshBadges: () => Promise<void>;
  setRack: (id: string) => void;
  select: (s: Selection) => void;

  createDevice: (body: Record<string, unknown>) => Promise<Device>;
  moveDevice: (id: string, to: Placement) => Promise<void>;
  updateDevice: (id: string, patch: Partial<Pick<Device, 'name' | 'hostname' | 'role' | 'os' | 'location_note' | 'status' | 'tags' | 'color_accent' | 'template_id'>>) => Promise<void>;
  deleteDevice: (id: string) => Promise<void>;
  duplicateDevice: (id: string) => Promise<Device>;
  setStatus: (id: string, status: DeviceStatus) => Promise<void>;

  createLink: (a: string, b: string, opts?: { cable_type?: CableType; cable_color?: string }) => Promise<Link>;
  updateLink: (id: string, patch: Partial<Pick<Link, 'cable_type' | 'cable_color' | 'length_m' | 'label' | 'notes'>>) => Promise<void>;
  deleteLink: (id: string) => Promise<void>;

  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export const useLab = create<LabState>((set, get) => {
  const id = (x: string) => {
    let cur = x;
    for (let i = 0; i < 20 && get().alias[cur]; i++) cur = get().alias[cur];
    return cur;
  };
  const push = (s: Step) => set((st) => ({ past: [...st.past, s].slice(-HISTORY_LIMIT), future: [] }));
  const putDevice = (d: Device) => set((st) => ({ devices: st.devices.some((x) => x.id === d.id) ? st.devices.map((x) => (x.id === d.id ? { ...x, ...d, ports: d.ports ?? x.ports } : x)) : [...st.devices, d] }));
  const portOwner = (portId: string) => get().devices.find((d) => d.ports.some((p) => p.id === portId));
  /** Local removal mirroring the server cascade: ports and cables go, riders drop to the tray. */
  const dropDevice = (did: string) =>
    set((st) => {
      const gone = st.devices.find((d) => d.id === did);
      const ps = new Set(gone?.ports.map((p) => p.id) ?? []);
      return {
        devices: st.devices.filter((d) => d.id !== did).map((d) => (d.shelf_device_id === did ? { ...d, shelf_device_id: null, shelf_slot: null } : d)),
        links: st.links.filter((l) => !ps.has(l.port_a_id) && !ps.has(l.port_b_id)),
        selection: st.selection?.id === did ? null : st.selection,
      };
    });

  async function rawMove(devId: string, to: Placement) {
    const d = await api.post<Device>(`/devices/${id(devId)}/move`, mapPlacement(to));
    putDevice(d);
  }
  const mapPlacement = (p: Placement): Placement => ({ ...p, shelf_device_id: p.shelf_device_id ? id(p.shelf_device_id) : null });

  async function rawCreateLink(a: string, b: string, extra: Partial<Link> = {}) {
    const l = await api.post<Link>('/links', { port_a_id: id(a), port_b_id: id(b), ...strip(extra) });
    set((st) => ({ links: [...st.links, l] }));
    return l;
  }
  async function rawDeleteLink(linkId: string) {
    await api.del(`/links/${id(linkId)}`);
    set((st) => ({ links: st.links.filter((l) => l.id !== id(linkId)), selection: st.selection?.id === id(linkId) ? null : st.selection }));
  }

  return {
    loaded: false,
    racks: [],
    templates: [],
    devices: [],
    links: [],
    badges: {},
    rackId: null,
    selection: null,
    past: [],
    future: [],
    alias: {},

    async load() {
      const [racks, templates, devices, links] = await Promise.all([
        api.get<Rack[]>('/racks'), api.get<DeviceTemplate[]>('/templates'), api.get<Device[]>('/devices'), api.get<Link[]>('/links'),
      ]);
      const rackId = get().rackId && racks.some((r) => r.id === get().rackId) ? get().rackId : racks[0]?.id ?? null;
      set({ racks, templates, devices, links, rackId, loaded: true });
      void get().refreshBadges();
    },
    async refreshBadges() {
      const b = await api.get<ProjectBadge[]>('/projects/badges');
      set({ badges: Object.fromEntries(b.map((x) => [x.device_id, x.open_count])) });
    },
    setRack: (rackId) => set({ rackId, selection: null }),
    select: (selection) => set({ selection }),

    async createDevice(body) {
      const d = await api.post<Device>('/devices', body);
      putDevice(d);
      let cur = d.id;
      push({
        label: `Add ${d.name}`,
        undo: async () => { await api.del(`/devices/${id(cur)}`); dropDevice(id(cur)); },
        redo: async () => {
          const again = await api.post<Device>('/devices', body);
          set((st) => ({ alias: { ...st.alias, [cur]: again.id } }));
          cur = again.id;
          putDevice(again);
        },
      });
      return d;
    },

    async moveDevice(devId, to) {
      const before = get().devices.find((d) => d.id === devId);
      if (!before) return;
      const from = placementOf(before);
      await rawMove(devId, to);
      push({ label: `Move ${before.name}`, undo: () => rawMove(devId, from), redo: () => rawMove(devId, to) });
    },

    async updateDevice(devId, patch) {
      const before = get().devices.find((d) => d.id === devId);
      if (!before) return;
      const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as any)[k]]));
      const apply = async (p: Record<string, unknown>) => {
        const d = await api.patch<Device>(`/devices/${id(devId)}`, p);
        putDevice(d);
        if ('template_id' in p) set({ links: await api.get<Link[]>('/links') });
      };
      await apply(patch);
      push({ label: `Edit ${before.name}`, undo: () => apply(prev), redo: () => apply(patch) });
    },

    async setStatus(devId, status) {
      await get().updateDevice(devId, { status });
    },

    async duplicateDevice(devId) {
      const d = await api.post<Device>(`/devices/${id(devId)}/duplicate`);
      putDevice(d);
      let cur = d.id;
      push({
        label: `Duplicate ${d.name}`,
        undo: async () => { await api.del(`/devices/${id(cur)}`); dropDevice(id(cur)); },
        redo: async () => {
          const again = await api.post<Device>(`/devices/${id(devId)}/duplicate`);
          set((st) => ({ alias: { ...st.alias, [cur]: again.id } }));
          cur = again.id;
          putDevice(again);
        },
      });
      return d;
    },

    async deleteDevice(devId) {
      const dev = get().devices.find((d) => d.id === devId);
      if (!dev) return;
      const portIds = new Set(dev.ports.map((p) => p.id));
      const cables = get().links.filter((l) => portIds.has(l.port_a_id) || portIds.has(l.port_b_id));
      const riders = get().devices.filter((d) => d.shelf_device_id === devId).map((d) => ({ id: d.id, slot: d.shelf_slot }));
      const snapshot = { ...dev };
      await api.del(`/devices/${id(devId)}`);
      dropDevice(devId);
      let cur = devId;
      push({
        label: `Delete ${dev.name}`,
        undo: async () => {
          // Re-create the device, restore per-device port edits, cables and anything that sat on it.
          const { id: _i, ports: oldPorts, created_at: _c, updated_at: _u, rack_side: _r, ...fields } = snapshot;
          const again = await api.post<Device>('/devices', { ...fields, ...mapPlacement(placementOf(snapshot)) });
          const aliases: Record<string, string> = { [cur]: again.id };
          for (const op of oldPorts) {
            const np = again.ports.find((p) => p.label === op.label);
            if (!np) continue;
            aliases[op.id] = np.id;
            if (np.layout_x !== op.layout_x || np.layout_y !== op.layout_y || np.speed_mbps !== op.speed_mbps || np.poe !== op.poe) {
              const upd = await api.patch<Port>(`/ports/${np.id}`, { layout_x: op.layout_x, layout_y: op.layout_y, speed_mbps: op.speed_mbps, poe: op.poe });
              again.ports = again.ports.map((p) => (p.id === upd.id ? upd : p));
            }
          }
          set((st) => ({ alias: { ...st.alias, ...aliases } }));
          cur = again.id;
          putDevice(again);
          for (const c of cables) {
            const { id: oldLinkId, port_a_id, port_b_id, created_at: _a, updated_at: _b, warnings: _w, ...rest } = c;
            try {
              const nl = await rawCreateLink(port_a_id, port_b_id, rest);
              set((st) => ({ alias: { ...st.alias, [oldLinkId]: nl.id } }));
            } catch { /* the far end may have been re-wired since */ }
          }
          for (const r of riders) {
            try { await rawMove(r.id, { ...UNPLACED, shelf_device_id: again.id, shelf_slot: r.slot }); } catch { /* slot reused */ }
          }
        },
        redo: async () => { await api.del(`/devices/${id(cur)}`); dropDevice(id(cur)); },
      });
    },

    async createLink(a, b, opts = {}) {
      const l = await rawCreateLink(a, b, opts as Partial<Link>);
      let cur = l.id;
      const da = portOwner(a)?.name ?? '?', db = portOwner(b)?.name ?? '?';
      push({
        label: `Cable ${da} to ${db}`,
        undo: () => rawDeleteLink(cur),
        redo: async () => {
          const again = await rawCreateLink(a, b, opts as Partial<Link>);
          set((st) => ({ alias: { ...st.alias, [cur]: again.id } }));
          cur = again.id;
        },
      });
      return l;
    },

    async updateLink(linkId, patch) {
      const before = get().links.find((l) => l.id === linkId);
      if (!before) return;
      const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as any)[k]]));
      const apply = async (p: Record<string, unknown>) => {
        const l = await api.patch<Link>(`/links/${id(linkId)}`, p);
        set((st) => ({ links: st.links.map((x) => (x.id === l.id ? l : x)) }));
      };
      await apply(patch);
      push({ label: 'Edit cable', undo: () => apply(prev), redo: () => apply(patch) });
    },

    async deleteLink(linkId) {
      const before = get().links.find((l) => l.id === linkId);
      if (!before) return;
      await rawDeleteLink(linkId);
      let cur = linkId;
      const { id: _i, port_a_id, port_b_id, created_at: _c, updated_at: _u, warnings: _w, ...rest } = before;
      push({
        label: 'Delete cable',
        undo: async () => {
          const again = await rawCreateLink(port_a_id, port_b_id, rest);
          set((st) => ({ alias: { ...st.alias, [cur]: again.id } }));
          cur = again.id;
        },
        redo: () => rawDeleteLink(cur),
      });
    },

    async undo() {
      const s = get().past.at(-1);
      if (!s) return;
      set((st) => ({ past: st.past.slice(0, -1) }));
      try {
        await s.undo();
        set((st) => ({ future: [...st.future, s] }));
      } catch (e) {
        await get().load();
        throw e;
      }
    },
    async redo() {
      const s = get().future.at(-1);
      if (!s) return;
      set((st) => ({ future: st.future.slice(0, -1) }));
      try {
        await s.redo();
        set((st) => ({ past: [...st.past, s] }));
      } catch (e) {
        await get().load();
        throw e;
      }
    },
  };
});

function strip(l: Partial<Link>) {
  const out: Record<string, unknown> = {};
  for (const k of ['cable_type', 'cable_color', 'length_m', 'label', 'notes'] as const) if (l[k] !== undefined) out[k] = l[k];
  return out;
}

// ---------- selectors ----------
export const templateOf = (templates: DeviceTemplate[], d: Device) => templates.find((t) => t.id === d.template_id);
