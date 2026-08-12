import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listLocations: vi.fn(), deactivateLocation: vi.fn(), reactivateLocation: vi.fn() }));
const permissions = vi.hoisted(() => ({ actions: new Set<string>(), loading: false }));
vi.mock('../locationApi', () => api);
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (_key: string, action: string) => permissions.actions.has(action), isLoading: permissions.loading }) }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/module-page', () => ({ ModulePage: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? <button onClick={onConfirm}>Confirm deactivation</button> : null }));
vi.mock('../LocationFormModal', () => ({
  LocationFormModal: ({ mode, location, onClose, onSaved }: { mode: string; location?: { name: string } | null; onClose: () => void; onSaved: () => void }) => (
    <div role="dialog">
      {mode}:{location?.name ?? 'new'}
      <button onClick={onClose}>Close dialog</button>
      <button onClick={onSaved}>Save complete</button>
    </div>
  ),
}));

import FleetLocationsPage from '../../../../../pages/fleet/locations';

const active = { id: 'loc-1', name: 'Depot', lat: -26.1, lon: 28.1, radiusKm: 1, locationType: 'depot', isGlobal: true, vehicleId: null, isActive: true };
const inactive = { ...active, id: 'loc-2', name: 'Old depot', isActive: false };

describe('FleetLocationsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); permissions.actions = new Set(); permissions.loading = false; api.listLocations.mockResolvedValue([active]); });

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
    expect(screen.getByRole('dialog')).toHaveTextContent('create:new');
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Depot' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('edit:Depot');
  });

  it('shows deactivate independently from edit permission', async () => {
    permissions.actions = new Set(['delete']);
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    expect(screen.getByRole('button', { name: 'Deactivate Depot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Depot' })).not.toBeInTheDocument();
  });

  it('deactivates after confirmation and reloads only after success', async () => {
    permissions.actions = new Set(['delete']);
    let resolve!: () => void;
    api.deactivateLocation.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Depot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    expect(api.listLocations).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    await waitFor(() => expect(api.listLocations).toHaveBeenCalledTimes(2));
  });

  it('keeps the row and reports a failed mutation', async () => {
    permissions.actions = new Set(['delete']);
    api.deactivateLocation.mockRejectedValue(new Error('Cannot deactivate referenced location'));
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Depot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot deactivate referenced location');
    expect(screen.getByText('Depot')).toBeInTheDocument();
    expect(api.listLocations).toHaveBeenCalledTimes(1);
  });

  it('closes and reloads only after the modal reports a successful save', async () => {
    permissions.actions = new Set(['edit']);
    render(<FleetLocationsPage />);
    await screen.findByText('Depot');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Depot' }));
    expect(api.listLocations).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save complete' })); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.listLocations).toHaveBeenCalledTimes(2));
  });

  it('reactivates inactive rows with edit permission', async () => {
    permissions.actions = new Set(['edit']); api.listLocations.mockResolvedValue([inactive]); api.reactivateLocation.mockResolvedValue(active);
    render(<FleetLocationsPage />);
    await screen.findByText('Old depot');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reactivate Old depot' })); });
    await waitFor(() => expect(api.reactivateLocation).toHaveBeenCalledWith('loc-2'));
    await waitFor(() => expect(api.listLocations).toHaveBeenCalledTimes(2));
  });
});
