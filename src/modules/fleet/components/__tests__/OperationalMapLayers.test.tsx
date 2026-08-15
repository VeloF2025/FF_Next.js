import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import type {
  AoiOverlayGeometry,
  OperationalBadgeRow,
  OperationalMapOverlay,
} from '../../operations/mapOverlayService';
import type { OperationalStatus } from '../../operations/types';

const leaflet = vi.hoisted(() => ({ divIcon: vi.fn((options: unknown) => ({ options })) }));
const layers = vi.hoisted(() => ({
  circleMarkers: vi.fn(),
  circles: vi.fn(),
  geoJson: vi.fn(),
  markers: vi.fn(),
}));

vi.mock('leaflet', () => ({ divIcon: leaflet.divIcon }));
vi.mock('react-leaflet', () => ({
  useMap: () => ({ getZoom: () => 12, setView: vi.fn() }),
  Marker: (props: {
    alt?: string;
    children?: React.ReactNode;
    eventHandlers?: { click?: () => void };
    icon: { options: { className: string } };
    title?: string;
  }) => {
    layers.markers(props);
    return (
      <button
        aria-label={props.alt}
        data-icon-class={props.icon.options.className}
        data-testid="operational-badge"
        onClick={props.eventHandlers?.click}
        title={props.title}
        type="button"
      >
        {props.children}
      </button>
    );
  },
  CircleMarker: (props: {
    children?: React.ReactNode;
    eventHandlers?: { click?: () => void };
    pathOptions: Record<string, unknown>;
  }) => {
    layers.circleMarkers(props);
    return (
      <button data-testid="attendance-marker" onClick={props.eventHandlers?.click} type="button">
        {props.children}
      </button>
    );
  },
  GeoJSON: (props: { children?: React.ReactNode; pathOptions: Record<string, unknown> }) => {
    layers.geoJson(props);
    return <section data-testid="aoi-geometry">{props.children}</section>;
  },
  Circle: (props: { children?: React.ReactNode; pathOptions: Record<string, unknown> }) => {
    layers.circles(props);
    return <section data-testid="circle-geometry">{props.children}</section>;
  },
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import { OperationalMapLayers } from '../OperationalMapLayers';

function badge(status: OperationalStatus, index: number): OperationalBadgeRow {
  return {
    vehicleId: `vehicle-${index}`,
    staffId: `staff-${index}`,
    staffName: `Driver ${index}`,
    projectId: 'project-1',
    projectName: 'Project One',
    operationalSiteId: 'site-1',
    operationalSiteName: 'Site One',
    status,
    flags: [],
    reasonCodes: [],
    evidenceTimestamps: [],
    ruleId: 'rule-1',
    ruleVersion: 1,
  };
}

function vehicle(index: number): LiveVehicle {
  return {
    vehicleId: `vehicle-${index}`,
    registration: `TEST ${index} GP`,
    driverName: `Driver ${index}`,
    provider: 'cartrack',
    lat: -26 - index / 100,
    lon: 28 + index / 100,
    speedKph: 0,
    ignition: false,
    isSpeeding: false,
    recordedAt: '2026-08-14T07:59:00.000Z',
    ageSeconds: 60,
    isStale: false,
    trackingState: 'tracked',
  };
}

function overlay(values: Partial<OperationalMapOverlay> = {}): OperationalMapOverlay {
  return {
    badges: [],
    attendancePoints: [],
    unplottable: [],
    page: 1,
    limit: 25,
    total: 0,
    hasMore: false,
    workDate: '2026-08-14',
    evaluatedAt: '2026-08-14T08:00:00.000Z',
    ...values,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OperationalMapLayers', () => {
  it('renders every badge group with a scoped class and accessible label', () => {
    const cases: Array<[OperationalStatus, string, string]> = [
      ['attendance_confirmed', 'on-site', 'On site'],
      ['approaching', 'approaching', 'Approaching'],
      ['late', 'late', 'Late'],
      ['wrong_site', 'wrong-site', 'Wrong site'],
      ['evidence_mismatch', 'mismatch', 'Evidence mismatch'],
      ['left_early', 'left-early', 'Left early'],
      ['unassigned', 'unassigned', 'Unassigned'],
      ['unverifiable', 'unverifiable', 'Unverifiable'],
      ['shift_complete', 'normal', 'Normal'],
    ];
    const badges = cases.map(([status], index) => badge(status, index));

    render(<OperationalMapLayers operationalOverlay={overlay({ badges })} vehicles={cases.map((_, index) => vehicle(index))} />);

    expect(screen.getAllByTestId('operational-badge')).toHaveLength(cases.length);
    cases.forEach(([, group, label], index) => {
      const marker = screen.getByRole('button', { name: `Driver ${index} — ${label} operational status` });
      expect(marker.dataset.iconClass).toContain('fleet-map-operational-badge');
      expect(marker.dataset.iconClass).toContain(`fleet-map-operational-badge--${group}`);
      expect(marker.textContent).toContain(label);
    });
    expect(leaflet.divIcon).toHaveBeenCalledTimes(cases.length);
  });

  it('labels Attendance evidence as non-live and shows its explicit timestamp', () => {
    render(<OperationalMapLayers operationalOverlay={overlay({ attendancePoints: [{
      staffId: 'attendance-staff', staffName: 'Attendance Driver', projectId: 'project-1',
      operationalSiteId: 'site-1', status: 'attendance_confirmed', latitude: -26.1,
      longitude: 28.1, recordedAt: '2026-08-14T06:01:00.000Z', source: 'attendance_clock_in',
      live: false, label: 'Attendance check-in evidence — not live tracking',
    }] })} vehicles={[]} />);

    const markerText = screen.getByTestId('attendance-marker').textContent;
    expect(markerText).toContain('Attendance check-in evidence — not live tracking');
    expect(markerText).toContain('Recorded at 2026-08-14T06:01:00.000Z');
    expect(layers.circleMarkers).toHaveBeenCalledWith(expect.objectContaining({
      center: [-26.1, 28.1],
      pathOptions: expect.objectContaining({
        className: 'fleet-map-attendance-marker', fillColor: '#2563eb', dashArray: '2 3',
      }),
    }));
  });

  it('renders selected AOI and Authorized Location geometry with the correct confidence styling', () => {
    const aoi = overlay({ geometry: {
      kind: 'aoi', operationalSiteId: 'site-1', projectId: 'project-1', operationalSiteName: 'Low AOI',
      confidence: 'low', lowConfidence: true,
      geoJson: { type: 'Polygon', coordinates: [[[28, -26], [28.1, -26], [28, -26]]] },
    } });
    const view = render(<OperationalMapLayers operationalOverlay={aoi} vehicles={[]} />);

    expect(screen.getByTestId('aoi-geometry')).toHaveTextContent('Low confidence geometry');
    expect(layers.geoJson).toHaveBeenCalledWith(expect.objectContaining({
      pathOptions: expect.objectContaining({
        className: 'fleet-map-operational-geometry fleet-map-operational-geometry--low-confidence',
        dashArray: '6 4',
      }),
    }));

    view.rerender(<OperationalMapLayers operationalOverlay={overlay({ geometry: {
      kind: 'authorized_location', operationalSiteId: 'site-2', projectId: 'project-1',
      operationalSiteName: 'Depot', center: { latitude: -26.2, longitude: 28.2 }, radiusM: 750,
    } })} vehicles={[]} />);
    expect(screen.getByTestId('circle-geometry')).toHaveTextContent('Depot');
    expect(layers.circles).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [-26.2, 28.2], radius: 750,
      pathOptions: expect.objectContaining({ className: 'fleet-map-operational-geometry' }),
    }));
  });

  it('remounts AOI layers for changed coordinates or site while retaining equal geometry identity', () => {
    const geometry: AoiOverlayGeometry = {
      kind: 'aoi', operationalSiteId: 'site-1', projectId: 'project-1', operationalSiteName: 'AOI One',
      confidence: 'medium', lowConfidence: false,
      geoJson: { coordinates: [[[28, -26], [28.1, -26], [28, -26]]], type: 'Polygon' },
    };
    const firstAoi = overlay({ geometry });
    const view = render(<OperationalMapLayers operationalOverlay={firstAoi} vehicles={[]} />);
    const originalLayer = screen.getByTestId('aoi-geometry');

    view.rerender(<OperationalMapLayers operationalOverlay={overlay({ geometry: {
      ...geometry,
      geoJson: { type: 'Polygon', coordinates: [[[28, -26], [28.1, -26], [28, -26]]] },
    } })} vehicles={[]} />);
    expect(screen.getByTestId('aoi-geometry')).toBe(originalLayer);

    view.rerender(<OperationalMapLayers operationalOverlay={overlay({ geometry: {
      ...geometry,
      geoJson: { type: 'Polygon', coordinates: [[[28, -26], [28.2, -26], [28, -26]]] },
    } })} vehicles={[]} />);
    const changedCoordinatesLayer = screen.getByTestId('aoi-geometry');
    expect(changedCoordinatesLayer).not.toBe(originalLayer);

    view.rerender(<OperationalMapLayers operationalOverlay={overlay({ geometry: {
      ...geometry, operationalSiteId: 'site-2', operationalSiteName: 'AOI Two',
    } })} vehicles={[]} />);
    expect(screen.getByTestId('aoi-geometry')).not.toBe(changedCoordinatesLayer);
  });

  it('never fabricates points for unplottable rows or badges whose live vehicle has no coordinates', () => {
    render(<OperationalMapLayers operationalOverlay={overlay({
      badges: [badge('late', 1)],
      unplottable: [{ staffId: 'staff-2', staffName: 'No Evidence', projectId: 'project-1',
        operationalSiteId: 'site-1', status: 'late', reason: 'no_permissible_coordinate' }],
    })} vehicles={[{ ...vehicle(1), lat: null }]} />);

    expect(layers.markers).not.toHaveBeenCalled();
    expect(layers.circleMarkers).not.toHaveBeenCalled();
    expect(layers.geoJson).not.toHaveBeenCalled();
    expect(layers.circles).not.toHaveBeenCalled();
  });

  it('keeps vehicle/staff marker identity stable across reorder and reports badge clicks', () => {
    const onStaffSelect = vi.fn();
    const first = badge('late', 1);
    const second = badge('wrong_site', 2);
    const view = render(<OperationalMapLayers operationalOverlay={overlay({ badges: [first, second] })}
      onStaffSelect={onStaffSelect} selectedStaffId="staff-2" vehicles={[vehicle(1), vehicle(2)]} />);
    const firstNode = screen.getByRole('button', { name: 'Driver 1 — Late operational status' });
    const secondNode = screen.getByRole('button', { name: 'Driver 2 — Wrong site operational status' });

    expect(secondNode.dataset.iconClass).toContain('fleet-map-operational-badge--selected');
    fireEvent.click(secondNode);
    expect(onStaffSelect).toHaveBeenCalledWith('staff-2');

    view.rerender(<OperationalMapLayers operationalOverlay={overlay({ badges: [second, first] })}
      onStaffSelect={onStaffSelect} selectedStaffId="staff-2" vehicles={[vehicle(2), vehicle(1)]} />);
    expect(screen.getByRole('button', { name: 'Driver 1 — Late operational status' })).toBe(firstNode);
    expect(screen.getByRole('button', { name: 'Driver 2 — Wrong site operational status' })).toBe(secondNode);
  });
});
