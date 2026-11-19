// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Device, DeviceTemplate, InventoryRow, Rack } from '@rackmap/shared';

// Every call the page makes goes through lib/api; the tests stand in for the server.
const server = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return { ...real, api: server };
});

import InventoryPage from './InventoryPage';
import { useLab } from '../store/lab';
import { useToast } from '../store/toast';
import { ApiError } from '../lib/api';
import { useUi } from '../store/ui';

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' };
const tpl: DeviceTemplate = { id: 't1', key: 'switch_8_port', name: '8 port switch', category: 'switch', form_factor: 'rack', height_u: 1, width_fraction: 1, port_layout: [], illustration_key: 'switch', shelf_slots: null, is_builtin: true, ...stamp };
const rack: Rack = { id: 'r1', name: 'Home Rack', total_units: 12, notes: null, ...stamp };
const dev = (id: string, name: string, over: Partial<Device> = {}): Device => ({
  id, name, hostname: null, template_id: 't1', rack_id: 'r1', rack_unit_start: null, rack_side: 'front', shelf_device_id: null, shelf_slot: null,
  role: null, os: null, location_note: null, status: 'online', tags: [], color_accent: null, ports: [], ...stamp, ...over,
});
const extras: InventoryRow[] = [];
const services = [
  { id: 's1', device_id: 'a', name: 'Proxmox VE', parent_service_id: null, kind: 'app', vmid_or_ctid: null, ip_address_id: null, port_number: 8006, url: 'https://10.0.0.1:8006', status: 'running', notes: null, sort_order: 0, ...stamp },
  { id: 's2', device_id: 'a', name: 'jellyfin', parent_service_id: 's1', kind: 'lxc', vmid_or_ctid: 101, ip_address_id: null, port_number: null, url: null, status: 'running', notes: null, sort_order: 0, ...stamp },
];

function seed() {
  const devices = [dev('a', 'Alpha', { rack_unit_start: 1, role: 'Edge' }), dev('b', 'Bravo', { rack_unit_start: 2 }), dev('c', 'Charlie', { rack_unit_start: 3 })];
  useLab.setState({ loaded: true, racks: [rack], templates: [tpl], devices, links: [], rackId: 'r1', selection: null, past: [], future: [], alias: {}, badges: {} });
}

function renderPage() {
  return render(<MemoryRouter><InventoryPage /></MemoryRouter>);
}
const row = (name: string) => within(screen.getByRole('table', { name: 'Devices' })).getAllByText(name)[0].closest('tr') as HTMLTableRowElement;

beforeEach(() => {
  seed();
  useToast.setState({ toasts: [] });
  server.get.mockImplementation(async (url: string) => (url === '/inventory' ? extras : url === '/services' ? services : []));
  useUi.setState({ focusService: null });
  server.patch.mockReset();
  server.post.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe('Inventory inline editing', () => {
  it('saves a cell through PATCH /devices/:id and shows the new value', async () => {
    server.patch.mockImplementation(async (_url: string, body: Partial<Device>) => ({ ...useLab.getState().devices[1], ...body }));
    renderPage();
    fireEvent.click(within(row('Bravo')).getByRole('button', { name: /Role of Bravo/ }));
    const input = screen.getByRole('textbox', { name: 'Role of Bravo' });
    fireEvent.change(input, { target: { value: 'Core' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(server.patch).toHaveBeenCalledWith('/devices/b', { role: 'Core' }));
    await waitFor(() => expect(within(row('Bravo')).getByRole('button', { name: /Role of Bravo: Core/ })).toBeTruthy());
    expect(useLab.getState().past.at(-1)?.label).toBe('Edit Bravo');
  });

  it('shows the edit at once, then rolls it back with an error toast when the API rejects it', async () => {
    let reject!: (e: unknown) => void;
    server.patch.mockImplementation(() => new Promise((_res, rej) => { reject = rej; }));
    renderPage();
    fireEvent.click(within(row('Alpha')).getByRole('button', { name: /Role of Alpha/ }));
    const input = screen.getByRole('textbox', { name: 'Role of Alpha' });
    fireEvent.change(input, { target: { value: 'Broken' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // optimistic
    await waitFor(() => expect(useLab.getState().devices.find((d) => d.id === 'a')!.role).toBe('Broken'));
    await act(async () => { reject(new ApiError(400, 'validation', 'Role is too long')); });
    await waitFor(() => expect(useLab.getState().devices.find((d) => d.id === 'a')!.role).toBe('Edge'));
    expect(useToast.getState().toasts.some((t) => t.kind === 'error' && /too long/.test(t.message))).toBe(true);
    expect(useLab.getState().past).toHaveLength(0);
  });
});

describe('Inventory keyboard', () => {
  it('arrows move the selection, Enter opens the drawer, Escape closes it, E edits the name', async () => {
    renderPage();
    // Default sort is status then name, so the order is Alpha, Bravo, Charlie.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(row('Alpha').dataset.active).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(row('Bravo').dataset.active).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(row('Alpha').dataset.active).toBe('true');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(useLab.getState().selection).toEqual({ kind: 'device', id: 'a' });
    await screen.findByRole('complementary', { name: 'Alpha details' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useLab.getState().selection).toBeNull();
    fireEvent.keyDown(window, { key: 'e' });
    expect(await screen.findByRole('textbox', { name: 'Name of Alpha' })).toBe(document.activeElement);
  });

  it('slash focuses the search box', () => {
    renderPage();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search devices' }));
  });
});

describe('Inventory bulk actions', () => {
  it('sets status on every checked device (shift-click range) as one undo step', async () => {
    server.patch.mockImplementation(async (url: string, body: Partial<Device>) => ({ ...useLab.getState().devices.find((d) => url.endsWith(`/${d.id}`))!, ...body }));
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Charlie' }), { shiftKey: true });
    expect(await screen.findByText('3 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    fireEvent.click(screen.getByRole('option', { name: /offline/ }));
    await waitFor(() => expect(server.patch).toHaveBeenCalledTimes(3));
    for (const id of ['a', 'b', 'c']) expect(server.patch).toHaveBeenCalledWith(`/devices/${id}`, { status: 'offline' });
    await waitFor(() => expect(useLab.getState().devices.every((d) => d.status === 'offline')).toBe(true));
    expect(useLab.getState().past).toHaveLength(1);
    expect(useLab.getState().past[0].label).toBe('Set status offline');
  });
});

describe('Inventory rack position', () => {
  it('shows the server collision error in the picker and leaves the device where it was', async () => {
    server.post.mockRejectedValue(new ApiError(409, 'collision', 'U1 is taken by Alpha'));
    renderPage();
    fireEvent.click(within(row('Bravo')).getByRole('button', { name: /Rack position of Bravo/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Bravo' });
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', 'U1 is taken by Alpha');
    expect(server.post).toHaveBeenCalledWith('/devices/b/move', { rack_id: 'r1', rack_unit_start: 1, shelf_device_id: null, shelf_slot: null });
    expect(useLab.getState().devices.find((d) => d.id === 'b')!.rack_unit_start).toBe(2);
  });
});

describe('Inventory services', () => {
  it('expands a device to list its services; clicking one opens the device panel on that service', async () => {
    renderPage();
    const toggle = await within(row('Alpha')).findByRole('button', { name: 'Show 2 services on Alpha' });
    expect(within(row('Bravo')).queryByRole('button', { name: /services on Bravo/ })).toBeNull();
    fireEvent.click(toggle);
    const link = await screen.findByRole('button', { name: 'Open jellyfin in the device panel' });
    expect(screen.getByRole('link', { name: /Open Proxmox VE web interface/ }).getAttribute('href')).toBe('https://10.0.0.1:8006');
    fireEvent.click(link);
    expect(useLab.getState().selection).toEqual({ kind: 'device', id: 'a' });
    expect(useUi.getState().focusService).toBe('s2');
    expect((await screen.findByRole('tab', { name: 'Services' })).getAttribute('aria-selected')).toBe('true');
  });

  it('searching for a service shows and expands its host', async () => {
    renderPage();
    await within(row('Alpha')).findByRole('button', { name: /services on Alpha/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search devices' }), { target: { value: 'jelly' } });
    expect(await screen.findByRole('button', { name: 'Open jellyfin in the device panel' })).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Devices' })).queryByText('Bravo')).toBeNull();
  });
});
