import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import type { OperationalMapOverlay } from '../../operations/mapOverlayService';

const layers = vi.hoisted(() => ({
  circleMarkers: vi.fn(),
  mapContainers: vi.fn(),
  markers: vi.fn(),
  tileLayers: vi.fn(),
}));
const leaflet = vi.hoisted(() => ({ divIcon: vi.fn((options: unknown) => ({ options })) }));

vi.mock('leaflet', () => ({ divIcon: leaflet.divIcon }));
vi.mock('react-leaflet', () => ({
  MapContainer: (props: { children?: React.ReactNode }) => {
    layers.mapContainers(props);
    return <div>{props.children}</div>;
  },
  TileLayer: (props: Record<string, unknown>) => { layers.tileLayers(props); return null; },
  CircleMarker: (props: { children?: React.ReactNode; pathOptions: Record<string, unknown> }) => {
    layers.circleMarkers(props);
    return <div data-testid="circle-marker">{props.children}</div>;
  },
  Marker: (props: { children?: React.ReactNode }) => {
    layers.markers(props);
    return <div data-testid="operational-badge">{props.children}</div>;
  },
  GeoJSON: () => null,
  Circle: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ getContainer: () => document.createElement('div'), invalidateSize: vi.fn() }),
}));

import FleetMap from '../FleetMap';

const vehicle: LiveVehicle = {
  vehicleId: 'vehicle-1',
  registration: 'ABC 123 GP',
  driverName: 'Jane Doe',
  provider: 'cartrack',
  lat: -26.1,
  lon: 28.05,
  speedKph: 42.6,
  ignition: false,
  isSpeeding: false,
  recordedAt: '2026-08-14T00:00:00.000Z',
  ageSeconds: 7 * 3600,
  isStale: true,
  trackingState: 'tracked',
};

const operationalOverlay: OperationalMapOverlay = {
  badges: [{
    vehicleId: 'vehicle-1', staffId: 'staff-1', staffName: 'Jane Doe', projectId: 'project-1',
    projectName: 'Project One', operationalSiteId: 'site-1', operationalSiteName: 'Site One',
    status: 'late', flags: [], reasonCodes: ['arrival_not_confirmed'], evidenceTimestamps: [],
    ruleId: 'rule-1', ruleVersion: 1,
  }],
  attendancePoints: [],
  unplottable: [],
  page: 1,
  limit: 25,
  total: 1,
  hasMore: false,
  workDate: '2026-08-14',
  evaluatedAt: '2026-08-14T08:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FleetMap operational composition', () => {
  it('keeps the legacy map, TileLayer, and vehicle marker contract when operational props are absent', () => {
    render(<FleetMap vehicles={[vehicle]} />);

    expect(layers.mapContainers).toHaveBeenCalledWith(expect.objectContaining({
      center: [-26.05, 28.1], zoom: 10, style: { height: '100%', width: '100%' },
    }));
    expect(layers.tileLayers).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 18, detectRetina: true,
    }));
    expect(layers.circleMarkers).toHaveBeenCalledTimes(1);
    expect(layers.markers).not.toHaveBeenCalled();
  });

  it('does not alter legacy marker grammar or popup content when an operational badge is added', () => {
    const view = render(<FleetMap vehicles={[vehicle]} />);
    const before = layers.circleMarkers.mock.calls[0]?.[0];
    layers.circleMarkers.mockClear();

    view.rerender(<FleetMap operationalOverlay={operationalOverlay} selectedStaffId="staff-1" vehicles={[vehicle]} />);

    const after = layers.circleMarkers.mock.calls[0]?.[0];
    const expectedPath = {
      color: '#ffffff', weight: 2, opacity: 1, dashArray: '3 3',
      fillColor: '#7c3aed', fillOpacity: 0.45,
    };
    expect(before.pathOptions).toEqual(expectedPath);
    expect(after.pathOptions).toEqual(expectedPath);
    expect(after.center).toEqual([-26.1, 28.05]);
    expect(after.radius).toBe(8);
    const popupText = screen.getByTestId('circle-marker').textContent;
    expect(popupText).toContain('ABC 123 GP');
    expect(popupText).toContain('Jane Doe');
    expect(popupText).toContain('Parked · no contact · 43 km/h');
    expect(popupText).toContain('Last fix: 7h ago (stale)');
    expect(popupText).toContain('via cartrack');
    expect(layers.markers).toHaveBeenCalledTimes(1);
  });

  it('can hide legacy vehicle circles without losing driver badge coordinate joins', () => {
    render(<FleetMap operationalOverlay={operationalOverlay} showVehicleMarkers={false} vehicles={[vehicle]} />);

    expect(layers.circleMarkers).not.toHaveBeenCalled();
    expect(layers.markers).toHaveBeenCalledTimes(1);
  });
});
