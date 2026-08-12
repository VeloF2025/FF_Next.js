import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listLocations: vi.fn(), deactivateLocation: vi.fn(), reactivateLocation: vi.fn() }));
const permissions = vi.hoisted(() => ({ actions: new Set<string>(), loading: false }));
vi.mock('../locationApi', () => api);
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (_key: string, action: string) => permissions.actions.has(action), isLoading: permissions.loading }) }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/module-page', () => ({ ModulePage: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../LocationFormModal', () => ({ LocationFormModal: ({ mode }: { mode: string }) => <div role="dialog">{mode}</div> }));

import FleetLocationsPage from '../../../../../pages/fleet/locations';

const active = { id: 'loc-1', name: 'Depot', lat: -26.1, lon: 28.1, radiusKm: 1, locationType: 'depot', isGlobal: true, vehicleId: null, isActive: true };
const inactive = { ...active, id: 'loc-2', name: 'Old depot', isActive: false };

describe('FleetLocationsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); permissions.actions = new Set(); permissions.loading = false; api.listLocations.mockResolvedValue([active]); vi.stubGlobal('confirm', vi.fn(() => true)); });

  it('hides mutation actions from a view-only user', async () => {
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    expect(screen.queryByRole('button', { name: 'Add location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Depot' })).not.toBeInTheDocument();
  });

  it('opens create and edit modes for authorised users', async () => {
    permissions.actions = new Set(['create', 'edit']);
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('create');
  });

  it('deactivates after confirmation and reloads only after success', async () => {
    permissions.actions = new Set(['delete']);
    let resolve!: () => void;
    api.deactivateLocation.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Depot' }));
    expect(api.listLocations).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    await waitFor(() => expect(api.listLocations).toHaveBeenCalledTimes(2));
  });

  it('reactivates inactive rows with edit permission', async () => {
    permissions.actions = new Set(['edit']); api.listLocations.mockResolvedValue([inactive]); api.reactivateLocation.mockResolvedValue(active);
    render(<FleetLocationsPage />);
    await screen.findByText('Old depot');
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Old depot' }));
    await waitFor(() => expect(api.reactivateLocation).toHaveBeenCalledWith('loc-2'));
    await waitFor(() => expect(api.listLocations).toHaveBeenCalledTimes(2));
  });
});
