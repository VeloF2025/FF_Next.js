import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedLocation } from '../../types';

const api = vi.hoisted(() => ({ createLocation: vi.fn(), updateLocation: vi.fn() }));
vi.mock('../locationApi', () => api);
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="map-picker" /> }));

import { LocationFormModal } from '../LocationFormModal';

const saved: AuthorizedLocation = {
  id: 'loc-1', name: 'Head Office', lat: -26.1, lon: 28.1, radiusKm: 1,
  locationType: 'office', isGlobal: true, vehicleId: null, isActive: true,
};

describe('LocationFormModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts create mode with work site and a one kilometre radius', () => {
    render(<LocationFormModal mode="create" location={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Location type')).toHaveValue('work_site');
    expect(screen.getByLabelText('Radius (km)')).toHaveValue(1);
    expect(screen.getByRole('option', { name: 'Office' })).toBeInTheDocument();
  });

  it('pre-populates edit values', () => {
    render(<LocationFormModal mode="edit" location={saved} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Head Office');
    expect(screen.getByLabelText('Location type')).toHaveValue('office');
    expect(screen.getByLabelText('Latitude')).toHaveValue(-26.1);
    expect(screen.getByLabelText('Longitude')).toHaveValue(28.1);
    expect(screen.getByLabelText('Radius (km)')).toHaveValue(1);
    expect(screen.getByLabelText('Global location')).toBeChecked();
    expect(screen.queryByLabelText('Vehicle')).not.toBeInTheDocument();
  });

  it('does not call the API when validation fails', async () => {
    render(<LocationFormModal mode="create" location={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create location' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it('loads a vehicle selector when the location is vehicle-specific', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'vehicle-1', registration: 'AB12CDGP' }] }) }));
    render(<LocationFormModal mode="create" location={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Global location'));
    expect(await screen.findByRole('option', { name: 'AB12CDGP' })).toBeInTheDocument();
  });

  it('requires a vehicle for a vehicle-specific location', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
    render(<LocationFormModal mode="create" location={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Vehicle yard' } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-26.1' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '28.1' } });
    fireEvent.click(screen.getByLabelText('Global location'));
    await screen.findByLabelText('Vehicle');
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Create location' }));
    expect(await screen.findByText('Vehicle is required for a vehicle-specific location')).toBeInTheDocument();
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it('reports API errors and stays open', async () => {
    api.createLocation.mockRejectedValue(new Error('Forbidden'));
    render(<LocationFormModal mode="create" location={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Head Office' } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-26.1' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '28.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create location' }));
    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('notifies the page only after the create request resolves', async () => {
    let resolveRequest!: (value: AuthorizedLocation) => void;
    api.createLocation.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const onSaved = vi.fn();
    render(<LocationFormModal mode="create" location={null} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Head Office' } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-26.1' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '28.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create location' }));
    expect(onSaved).not.toHaveBeenCalled();
    resolveRequest(saved);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });
});
