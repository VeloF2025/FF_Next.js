import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mapEvents = vi.hoisted(() => ({ click: (_event: unknown) => undefined }));
const circleProps = vi.hoisted(() => vi.fn());
const markerProps = vi.hoisted(() => vi.fn());

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Circle: (props: { radius: number }) => { circleProps(props); return null; },
  CircleMarker: (props: { center: [number, number] }) => { markerProps(props); return null; },
  useMapEvents: (events: typeof mapEvents) => {
    mapEvents.click = events.click;
    return null;
  },
}));

import { LocationMapPicker } from '../LocationMapPicker';

describe('LocationMapPicker', () => {
  beforeEach(() => {
    circleProps.mockClear();
    markerProps.mockClear();
  });

  it('reports map clicks rounded to seven decimal places', () => {
    const onChange = vi.fn();
    render(<LocationMapPicker lat={-26.1} lon={28.1} radiusKm={1} onChange={onChange} />);

    act(() => {
      mapEvents.click({ latlng: { lat: -26.123456789, lng: 28.234567891 } });
    });

    expect(onChange).toHaveBeenCalledWith({ lat: -26.1234568, lon: 28.2345679 });
  });

  it('renders the configured radius in metres', () => {
    render(<LocationMapPicker lat={-26.1} lon={28.1} radiusKm={1.25} onChange={vi.fn()} />);
    expect(circleProps).toHaveBeenCalledWith(expect.objectContaining({ radius: 1250 }));
  });

  it('does not render geometry for invalid coordinates', () => {
    render(<LocationMapPicker lat={Number.NaN} lon={28.1} radiusKm={1} onChange={vi.fn()} />);
    expect(circleProps).not.toHaveBeenCalled();
    expect(markerProps).not.toHaveBeenCalled();
  });

  it('keeps the marker but omits the circle for an invalid radius', () => {
    render(<LocationMapPicker lat={-26.1} lon={28.1} radiusKm={Number.NaN} onChange={vi.fn()} />);
    expect(markerProps).toHaveBeenCalled();
    expect(circleProps).not.toHaveBeenCalled();
  });
});
