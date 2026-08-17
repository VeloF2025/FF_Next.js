import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';

interface Coordinates {
  lat: number;
  lon: number;
}

interface LocationMapPickerProps extends Coordinates {
  radiusKm: number;
  onChange: (coordinates: Coordinates) => void;
}

function ClickHandler({ onChange }: Pick<LocationMapPickerProps, 'onChange'>) {
  useMapEvents({
    click(event) {
      onChange({
        lat: Number(event.latlng.lat.toFixed(7)),
        lon: Number(event.latlng.lng.toFixed(7)),
      });
    },
  });
  return null;
}

function ViewportFollower({ center, active }: { center: [number, number]; active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (active) map.setView(center, 14);
  }, [active, center, map]);
  return null;
}

export function LocationMapPicker({ lat, lon, radiusKm, onChange }: LocationMapPickerProps) {
  const validCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const validRadius = Number.isFinite(radiusKm) && radiusKm > 0;
  const center: [number, number] = validCoordinates ? [lat, lon] : [-30.5595, 22.9375];

  return (
    <div className="h-64 overflow-hidden rounded-lg border border-[var(--ff-border-light)]">
      <MapContainer center={center} zoom={validCoordinates ? 14 : 5} className="h-full w-full">
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onChange={onChange} />
        <ViewportFollower center={center} active={validCoordinates} />
        {validCoordinates && (
          <>
            {validRadius && <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: '#2563eb' }} />}
            <CircleMarker center={center} radius={6} pathOptions={{ color: '#1d4ed8', fillOpacity: 1 }} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
