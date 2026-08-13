import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSiteManager } from '../ProjectSiteManager';

describe('ProjectSiteManager', () => {
  it('links reviewed AOI metadata and exposes existing-site controls', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined); const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<ProjectSiteManager sources={[{ id: 'aoi-1', label: 'LAW — Zone 1', kind: 'aoi', confidence: 'low', warning: 'Review this AOI before linking' }]} sites={[{ id: 'site-1', projectId: 'project', displayName: 'Old depot', projectAoiId: 'aoi-0', authorizedLocationId: null, isDefault: false, isActive: true }]} onCreate={onCreate} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('Site source'), { target: { value: 'aoi:aoi-1' } });
    expect(screen.getByText(/Confidence: low/)).toBeInTheDocument(); expect(screen.getByText(/Review this AOI/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'Lawley Zone 1' } }); fireEvent.click(screen.getByText('Add site'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ displayName: 'Lawley Zone 1', projectAoiId: 'aoi-1', authorizedLocationId: null, isDefault: false }));
    expect(screen.getByText('Old depot')).toBeInTheDocument(); fireEvent.click(screen.getByLabelText('Make Old depot default'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('site-1', { isDefault: true }));
  });

  it('creates a geofence and supports rename and deactivate', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined); const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<ProjectSiteManager sources={[{ id: 'geo-1', label: 'Main depot', kind: 'location' }]} sites={[{ id: 'site-1', projectId: 'project', displayName: 'Old depot', projectAoiId: null, authorizedLocationId: 'geo-1', isDefault: false, isActive: true }]} onCreate={onCreate} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('Site source'), { target: { value: 'location:geo-1' } });
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'Depot geofence' } }); fireEvent.click(screen.getByText('Add site'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ displayName: 'Depot geofence', projectAoiId: null, authorizedLocationId: 'geo-1', isDefault: false }));
    fireEvent.change(screen.getByLabelText('Rename Old depot'), { target: { value: 'Renamed depot' } }); fireEvent.click(screen.getByText('Rename'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('site-1', { displayName: 'Renamed depot' }));
    fireEvent.click(screen.getByLabelText('Deactivate Old depot'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('site-1', { isActive: false }));
  });

  it('retains a site API error for manager correction', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('Site update conflict'));
    render(<ProjectSiteManager sources={[]} sites={[{ id: 'site-1', projectId: 'project', displayName: 'Depot', projectAoiId: null, authorizedLocationId: 'geo-1', isDefault: false, isActive: true }]} onCreate={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Deactivate Depot'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Site update conflict');
    fireEvent.change(screen.getByLabelText('Rename Depot'), { target: { value: 'Correction' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Site update conflict');
  });
});
