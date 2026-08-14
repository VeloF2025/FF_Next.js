/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AssignmentOption } from '../../../assignments/rosterQueries';
import type { OperationalMapOverlay } from '../../mapOverlayService';
import { MapOperationsToolbar } from '../MapOperationsToolbar';
import type { OperationFilters } from '../operationFilters';
import {
  OperationsPresentationApiError,
  type LiveFleetTelemetry,
} from '../operationsPresentationApi';
import type { FleetMapLayerState } from '../useFleetMapLayers';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const projects: AssignmentOption[] = [{ id: PROJECT_ID, label: 'Lawley' }];

function layer<T>(overrides: Partial<FleetMapLayerState<T>> = {}): FleetMapLayerState<T> {
  return {
    data: null,
    lastSuccessAt: null,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function ToolbarHarness() {
  const [filters, setFilters] = useState<OperationFilters>({
    projectId: PROJECT_ID,
    workDate: '2026-08-14',
    asOf: '2026-08-14T08:00:00.000Z',
    visibility: 'all',
  });
  return (
    <MapOperationsToolbar
      filters={filters}
      onChange={setFilters}
      overlay={layer<OperationalMapOverlay>()}
      projects={projects}
      telemetry={layer<LiveFleetTelemetry>()}
    />
  );
}

describe('MapOperationsToolbar', () => {
  it('updates project, status, evidence, visibility, and date controls without conflicting filters', () => {
    render(<ToolbarHarness />);

    fireEvent.change(screen.getByLabelText('Map status'), { target: { value: 'group:on_site' } });
    expect(screen.getByLabelText('Map status')).toHaveValue('group:on_site');
    fireEvent.change(screen.getByLabelText('Map status'), { target: { value: 'status:late' } });
    expect(screen.getByLabelText('Map status')).toHaveValue('status:late');
    fireEvent.change(screen.getByLabelText('Map evidence'), { target: { value: 'stale' } });
    expect(screen.getByLabelText('Map evidence')).toHaveValue('stale');
    fireEvent.change(screen.getByLabelText('Map visibility'), { target: { value: 'drivers' } });
    expect(screen.getByLabelText('Map visibility')).toHaveValue('drivers');
    fireEvent.change(screen.getByLabelText('Map date'), { target: { value: '2026-08-13' } });
    expect(screen.getByLabelText('Map date')).toHaveValue('2026-08-13');
    expect(screen.getByText('Historical view')).toBeInTheDocument();
    expect(screen.getByText(/2026\/08\/13/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Map date'), { target: { value: '' } });
    expect(screen.getByLabelText('Map date')).toHaveValue('2026-08-13');
  });

  it('labels current state and reports telemetry and overlay freshness independently', () => {
    const telemetryRefresh = vi.fn().mockResolvedValue(undefined);
    const overlayRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <MapOperationsToolbar
        filters={{ projectId: PROJECT_ID, workDate: '2026-08-14', visibility: 'all' }}
        onChange={vi.fn()}
        overlay={layer<OperationalMapOverlay>({
          lastSuccessAt: '2026-08-14T08:05:00.000Z',
          error: new OperationsPresentationApiError('private detail', 403, 'FORBIDDEN'),
          refresh: overlayRefresh,
        })}
        projects={projects}
        projectOptionsError
        telemetry={layer<LiveFleetTelemetry>({
          data: { vehicles: [] },
          lastSuccessAt: '2026-08-14T08:04:00.000Z',
          error: new OperationsPresentationApiError('provider detail', 503, 'UNAVAILABLE'),
          refresh: telemetryRefresh,
        })}
      />,
    );

    expect(screen.getByText('Current view')).toBeInTheDocument();
    expect(screen.getByText(/Vehicles updated/).querySelector('time')).toHaveAttribute(
      'datetime', '2026-08-14T08:04:00.000Z',
    );
    expect(screen.getByText(/Operations updated/).querySelector('time')).toHaveAttribute(
      'datetime', '2026-08-14T08:05:00.000Z',
    );
    expect(screen.getByText('Live vehicle refresh failed; showing last successful positions.')).toBeInTheDocument();
    expect(screen.getByText('Operational overlay is unavailable for this account.')).toBeInTheDocument();
    expect(screen.queryByText('private detail')).not.toBeInTheDocument();
    expect(screen.queryByText('provider detail')).not.toBeInTheDocument();
    expect(screen.getByText('Project options could not be refreshed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh vehicles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh operations' }));
    expect(telemetryRefresh).toHaveBeenCalledTimes(1);
    expect(overlayRefresh).toHaveBeenCalledTimes(1);
  });
});
