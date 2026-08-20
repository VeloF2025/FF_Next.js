/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetMapProps } from '../../../components/FleetMap';
import type { OperationalMapOverlay } from '../../mapOverlayService';
import { OperationsPresentationApiError, type LiveFleetTelemetry } from '../operationsPresentationApi';
import type { FleetMapLayersState } from '../useFleetMapLayers';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const pageMocks = vi.hoisted(() => ({
  layers: null as FleetMapLayersState | null,
  mapProps: vi.fn<(props: FleetMapProps) => void>(),
  assignmentOptions: vi.fn(),
  operationsOptions: vi.fn(),
  router: { asPath: '/fleet/map', isReady: true },
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/dynamic', () => ({
  default: () => (props: FleetMapProps) => {
    pageMocks.mapProps(props);
    return <div data-testid="fleet-map">Telemetry markers: {props.vehicles.length}</div>;
  },
}));
vi.mock('next/router', () => ({ useRouter: () => pageMocks.router }));
vi.mock('../useFleetMapLayers', () => ({ useFleetMapLayers: () => pageMocks.layers }));
vi.mock('../../../assignments/web/assignmentApi', () => ({
  assignmentApi: { options: (...args: unknown[]) => pageMocks.assignmentOptions(...args) },
  AssignmentApiError: class AssignmentApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
  },
}));
vi.mock('../operationsPresentationApi', async () => {
  const actual = await vi.importActual<typeof import('../operationsPresentationApi')>('../operationsPresentationApi');
  return { ...actual, operationsPresentationApi: {
    ...actual.operationsPresentationApi,
    projectOptions: (...args: unknown[]) => pageMocks.operationsOptions(...args),
  } };
});

import FleetMapPage from '../../../../../../pages/fleet/map';

const telemetry: LiveFleetTelemetry = {
  vehicles: [
    {
      vehicleId: 'vehicle-1', registration: 'ABC 123 GP', driverName: 'Late Driver', provider: 'cartrack',
      lat: -26.1, lon: 28.1, speedKph: 20, ignition: true, isSpeeding: false,
      recordedAt: '2026-08-14T08:00:00.000Z', ageSeconds: 10, isStale: false,
      staleAfterSeconds: 300, trackingState: 'tracked',
    },
    {
      vehicleId: 'vehicle-2', registration: 'NO TRACKER', driverName: null, provider: null,
      lat: null, lon: null, speedKph: null, ignition: null, isSpeeding: null,
      recordedAt: null, ageSeconds: null, isStale: false, staleAfterSeconds: 300,
      trackingState: 'untracked',
    },
  ],
};
const overlay: OperationalMapOverlay = {
  badges: [{
    vehicleId: 'vehicle-1', staffId: STAFF_ID, staffName: 'Late Driver', projectId: PROJECT_ID,
    projectName: 'Lawley', operationalSiteId: 'site-1', operationalSiteName: 'Zone A', status: 'late',
    flags: ['attendance_missing'], reasonCodes: ['arrival_not_confirmed'], evidenceTimestamps: [],
    ruleId: 'rule-1', ruleVersion: 1,
  }],
  attendancePoints: [],
  unplottable: [{
    staffId: 'staff-missing', staffName: 'Missing Driver', projectId: PROJECT_ID,
    operationalSiteId: 'site-1', status: 'unverifiable', reason: 'no_permissible_coordinate',
  }],
  page: 1, limit: 100, total: 2, hasMore: false,
  workDate: '2026-08-14', evaluatedAt: '2026-08-14T08:00:00.000Z',
};

function layerState(options: { overlayData?: OperationalMapOverlay | null; overlayError?: OperationsPresentationApiError | null } = {}): FleetMapLayersState {
  return {
    telemetry: {
      data: telemetry, lastSuccessAt: '2026-08-14T08:00:00.000Z', error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    overlay: {
      data: options.overlayData === undefined ? overlay : options.overlayData,
      lastSuccessAt: options.overlayData === null ? null : '2026-08-14T08:00:00.000Z',
      error: options.overlayError ?? null, refresh: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function lastMapProps(): FleetMapProps {
  const call = pageMocks.mapProps.mock.calls.at(-1);
  if (!call) throw new Error('FleetMap was not rendered');
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, shouldClearNativeTimers: true });
  vi.setSystemTime(new Date('2026-08-14T08:00:00.000Z'));
  window.history.replaceState({}, '', `/fleet/map?projectId=${PROJECT_ID}&workDate=2026-08-14&visibility=all`);
  pageMocks.router.asPath = `/fleet/map?projectId=${PROJECT_ID}&workDate=2026-08-14&visibility=all`;
  pageMocks.router.isReady = true;
  pageMocks.layers = layerState();
  pageMocks.assignmentOptions.mockReturnValue(new Promise(() => undefined));
  pageMocks.operationsOptions.mockResolvedValue([{ id: PROJECT_ID, label: 'Lawley' }]);
});

describe('Fleet map page operational composition', () => {
  it('retains the full-height telemetry shell, legend, counts, and not-on-map footer after overlay permission failure', async () => {
    pageMocks.layers = layerState({
      overlayData: null,
      overlayError: new OperationsPresentationApiError('Private scope', 403, 'FORBIDDEN'),
    });
    const { container } = render(<FleetMapPage />);
    await waitFor(() => expect(pageMocks.operationsOptions).toHaveBeenCalled());

    expect(screen.getByRole('heading', { name: 'Fleet map' })).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 2 active vehicles\. 1 not on the map\./)).toBeInTheDocument();
    expect(screen.getByText(/Positions refresh every 30 seconds/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Map legend' })).getByText(/Moving/))
      .toHaveTextContent('(1)');
    expect(screen.getByText(/NO TRACKER \(no tracker\)/)).toBeInTheDocument();
    expect(container.querySelector('.absolute.inset-x-0.top-0')).toHaveClass(
      'bottom-[env(safe-area-inset-bottom)]', 'flex', 'flex-col', 'min-h-[500px]',
    );
    expect(screen.getByTestId('fleet-map')).toHaveTextContent('Telemetry markers: 2');
    expect(lastMapProps()).toMatchObject({ vehicles: telemetry.vehicles, operationalOverlay: undefined });
    expect(screen.getByText('Operational overlay is unavailable for this account.')).toBeInTheDocument();
  });

  it('keeps URL filters and staff focus synchronized across visibility modes', async () => {
    render(<FleetMapPage />);
    await waitFor(() => expect(pageMocks.operationsOptions).toHaveBeenCalled());
    expect(new URLSearchParams(window.location.search).get('projectId')).toBe(PROJECT_ID);

    fireEvent.change(screen.getByLabelText('Map visibility'), { target: { value: 'drivers' } });
    expect(new URLSearchParams(window.location.search).get('visibility')).toBe('drivers');
    expect(lastMapProps().showVehicleMarkers).toBe(false);
    expect(lastMapProps().operationalOverlay).toBeDefined();

    fireEvent.change(screen.getByLabelText('Map status'), { target: { value: 'status:late' } });
    fireEvent.change(screen.getByLabelText('Map evidence'), { target: { value: 'vehicle_only' } });
    fireEvent.change(screen.getByLabelText('Map date'), { target: { value: '2026-08-13' } });
    const historicalQuery = new URLSearchParams(window.location.search);
    expect(historicalQuery.get('status')).toBe('late');
    expect(historicalQuery.get('evidence')).toBe('vehicle_only');
    expect(historicalQuery.get('workDate')).toBe('2026-08-13');
    expect(historicalQuery.get('asOf')).toBe('2026-08-13T21:59:59.999Z');
    expect(screen.getByText('Historical view')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Map visibility'), { target: { value: 'vehicles' } });
    expect(lastMapProps().showVehicleMarkers).toBe(true);
    expect(lastMapProps().operationalOverlay).toBeUndefined();
    expect(screen.queryByTestId('map-attention-desktop')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Map visibility'), { target: { value: 'all' } });
    act(() => lastMapProps().onStaffSelect?.(STAFF_ID));
    expect(new URLSearchParams(window.location.search).get('staffId')).toBe(STAFF_ID);
    const panel = screen.getByTestId('map-attention-desktop');
    const focus = within(panel).getByRole('button', { name: 'Focus Late Driver on map' });
    expect(focus).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(focus);
    expect(lastMapProps()).toMatchObject({ focusStaffId: STAFF_ID, focusRequestId: 2 });
  });

  it('clears selected protected staff state after a successful overlay becomes forbidden', async () => {
    pageMocks.router.asPath = `/fleet/map?projectId=${PROJECT_ID}&staffId=${STAFF_ID}&workDate=2026-08-14`;
    window.history.replaceState({}, '', pageMocks.router.asPath);
    const view = render(<FleetMapPage />);
    await waitFor(() => expect(lastMapProps().selectedStaffId).toBe(STAFF_ID));
    expect(lastMapProps().operationalOverlay).toBeDefined();

    pageMocks.layers = layerState({ overlayData: null,
      overlayError: new OperationsPresentationApiError('Private scope', 403, 'FORBIDDEN') });
    view.rerender(<FleetMapPage />);

    await waitFor(() => expect(lastMapProps().selectedStaffId).toBeNull());
    expect(lastMapProps().operationalOverlay).toBeUndefined();
    expect(new URLSearchParams(window.location.search).has('staffId')).toBe(false);
    expect(lastMapProps().vehicles).toEqual(telemetry.vehicles);
  });

  it('initializes query-backed filters after mount so server markup is URL-independent', async () => {
    pageMocks.router.asPath = `/fleet/map?projectId=${PROJECT_ID}&workDate=2026-08-14&status=late&visibility=drivers`;
    window.history.replaceState({}, '', pageMocks.router.asPath);

    const serverHtml = renderToString(<FleetMapPage />);
    expect(serverHtml).not.toContain('value="status:late" selected=""');

    render(<FleetMapPage />);
    await waitFor(() => expect(screen.getByLabelText('Map status')).toHaveValue('status:late'));
    expect(screen.getByLabelText('Map visibility')).toHaveValue('drivers');
  });

  it('uses operations-status project options rather than assignment options', async () => {
    render(<FleetMapPage />);

    await waitFor(() => expect(pageMocks.operationsOptions).toHaveBeenCalled());
    expect(pageMocks.assignmentOptions).not.toHaveBeenCalled();
    expect(await screen.findByRole('option', { name: 'Lawley' })).toBeInTheDocument();
  });

  it('discloses when the map overlay fetch was truncated by the server limit', async () => {
    pageMocks.layers = layerState({ overlayData: { ...overlay, total: 150, hasMore: true } });
    render(<FleetMapPage />);
    await waitFor(() => expect(pageMocks.operationsOptions).toHaveBeenCalled());

    expect(await screen.findByText(/Showing 2 of 150/)).toBeInTheDocument();
    expect(screen.getByText(/148 more not shown/)).toBeInTheDocument();
  });

  it('explains an operational badge whose vehicle has no telemetry coordinate join', async () => {
    pageMocks.layers = layerState({ overlayData: {
      ...overlay,
      badges: [{ ...overlay.badges[0]!, vehicleId: 'missing-vehicle' }],
      unplottable: [],
      total: 1,
    } });
    render(<FleetMapPage />);

    await waitFor(() => expect(screen.getByText(
      'Vehicle telemetry is unavailable; this person is not plotted.',
    )).toBeInTheDocument());
    expect(lastMapProps().operationalOverlay?.badges).toEqual([]);
  });
});
