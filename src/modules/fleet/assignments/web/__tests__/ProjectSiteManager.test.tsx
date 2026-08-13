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
});
