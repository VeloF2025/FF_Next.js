/**
 * The historical-route layer.
 *
 * A trip closed by tracker silence must not be drawn like one that closed on ignition off: its
 * end point is the last fix, and a solid line to a filled marker presents that as a confirmed
 * stop. The distinction is asserted on what reaches Leaflet, because it is invisible in text.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FleetMapDayRoute from '../FleetMapDayRoute';
import type { RouteLeg } from '../FleetMapDayRoute';

const layers = vi.hoisted(() => ({
  polylines: vi.fn(), circles: vi.fn(), map: { fitBounds: vi.fn() },
}));
vi.mock('react-leaflet', () => ({
  useMap: () => layers.map,
  Polyline: (props: Record<string, unknown>) => { layers.polylines(props); return null; },
  CircleMarker: (props: { children?: React.ReactNode }) => {
    layers.circles(props);
    return <div data-testid="route-marker">{props.children}</div>;
  },
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

interface PathOptions { dashArray?: string; fillOpacity?: number }
type StyledProps = { pathOptions: PathOptions };

function leg(overrides: Partial<RouteLeg> = {}): RouteLeg {
  return {
    id: 'leg-1',
    path: [[-26.2, 28.0], [-26.1, 28.1]],
    countsTowardMetrics: true,
    closeReason: 'ignition_off',
    label: 'Start 08:00 — Depot',
    endLabel: 'End 09:00 (1h 0m)',
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('a completed trip', () => {
  it('draws a solid line and a filled end marker', () => {
    render(<FleetMapDayRoute legs={[leg()]} />);
    const [props] = layers.polylines.mock.calls[0] as [StyledProps];
    expect(props.pathOptions.dashArray).toBeUndefined();
    const end = layers.circles.mock.calls[1]![0] as StyledProps;
    expect(end.pathOptions.fillOpacity).toBe(1);
  });
});

describe('a trip closed by tracker silence', () => {
  it('draws a dashed line and a hollow end marker', () => {
    render(<FleetMapDayRoute legs={[leg({ closeReason: 'timeout' })]} />);
    const [props] = layers.polylines.mock.calls[0] as [StyledProps];
    expect(props.pathOptions.dashArray).toBe('8 6');
    const end = layers.circles.mock.calls[1]![0] as StyledProps;
    expect(end.pathOptions.fillOpacity).toBe(0);
  });
});

describe('framing the day', () => {
  it('fits the map to the route’s own points, not the live map’s fixed Gauteng view', () => {
    render(<FleetMapDayRoute legs={[leg(), leg({ id: 'leg-2', path: [[-25.7, 28.2]] })]} />);
    expect(layers.map.fitBounds).toHaveBeenCalledWith(
      [[-26.2, 28.0], [-26.1, 28.1], [-25.7, 28.2]],
      { padding: [24, 24] },
    );
  });

  it('does not call fitBounds with an empty set — Leaflet throws on that', () => {
    render(<FleetMapDayRoute legs={[]} />);
    expect(layers.map.fitBounds).not.toHaveBeenCalled();
  });
});

describe('a leg with a single point', () => {
  it('marks it without drawing a line to nowhere', () => {
    render(<FleetMapDayRoute legs={[leg({ path: [[-26.2, 28.0]] })]} />);
    expect(layers.polylines).not.toHaveBeenCalled();
    expect(layers.circles).toHaveBeenCalledTimes(2);
  });
});
