import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from 'react-leaflet';
import type { FnoNetwork } from '../data/fnoAtlasData';
import { getBrandProfile } from '../data/fnoBrandMapData';
import type { LatLngTuple } from '../data/fnoBrandMapData';

const SOUTH_AFRICA_CENTER: LatLngTuple = [-29.0, 24.0];
const cardStyle = { backgroundColor: 'var(--ff-surface)', borderColor: 'var(--ff-border-subtle)' };

interface FnoInteractiveMapProps {
  networks: FnoNetwork[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function FnoInteractiveMap({ networks, selectedId, onSelect }: FnoInteractiveMapProps) {
  const selected = networks.find((network) => network.id === selectedId) ?? networks[0];
  const selectedProfile = selected ? getBrandProfile(selected.id) : undefined;
  const visibleIds = new Set(networks.map((network) => network.id));

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="overflow-hidden rounded-2xl border shadow-sm" style={cardStyle}>
        <div className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: 'var(--ff-border-subtle)' }}>
          <div>
            <h2 className="text-xl font-semibold">Interactive FNO coverage map</h2>
            <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
              Brand-coloured reference points; click a marker or legend item to isolate an FNO.
            </p>
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'var(--ff-surface-alt)', color: 'var(--ff-text-secondary)' }}>
            OpenStreetMap
          </span>
        </div>
        <MapContainer center={SOUTH_AFRICA_CENTER} zoom={5} scrollWheelZoom className="h-[560px] w-full">
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {networks.map((network) => {
            const profile = getBrandProfile(network.id);
            if (!profile) return null;
            const active = !selected || selected.id === network.id;
            return profile.mapPoints.map((point) => (
              <CircleMarker
                key={`${network.id}-${point.label}`}
                center={point.position}
                radius={active ? 12 : 8}
                pathOptions={{
                  color: profile.brandColor,
                  fillColor: profile.brandColor,
                  fillOpacity: active ? 0.82 : 0.42,
                  opacity: visibleIds.has(network.id) ? 1 : 0.25,
                  weight: active ? 4 : 2,
                }}
                eventHandlers={{ click: () => onSelect(network.id) }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  {network.name} · {point.label}
                </Tooltip>
                <Popup>
                  <strong>{network.name}</strong>
                  <br />
                  {point.label}
                  <br />
                  {point.note}
                  <br />
                  <a href={network.coverageSource} target="_blank" rel="noreferrer">Coverage source</a>
                </Popup>
              </CircleMarker>
            ));
          })}
        </MapContainer>
      </div>

      <aside className="rounded-2xl border p-4 shadow-sm" style={cardStyle}>
        <h3 className="text-lg font-semibold">FNO colour key</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
          Colours are brand-aligned from each FNO website/logo palette, then adjusted only enough to stay distinguishable on the map.
        </p>
        <div className="mt-4 max-h-[470px] space-y-2 overflow-y-auto pr-1">
          {networks.map((network) => {
            const profile = getBrandProfile(network.id);
            if (!profile) return null;
            const active = selected?.id === network.id;
            return (
              <button
                key={network.id}
                type="button"
                onClick={() => onSelect(network.id)}
                className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:shadow-sm"
                style={{
                  borderColor: active ? profile.brandColor : 'var(--ff-border-subtle)',
                  backgroundColor: active ? 'var(--ff-surface-alt)' : 'var(--ff-surface)',
                  color: 'var(--ff-text-primary)',
                }}
              >
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: profile.brandColor }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{network.name}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
                    {profile.brandColorLabel} · {profile.mapPoints.length} map point{profile.mapPoints.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {selected && selectedProfile && (
          <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: selectedProfile.brandColor }}>
            <p className="font-semibold">{selected.name}</p>
            <p className="mt-1" style={{ color: 'var(--ff-text-secondary)' }}>{selectedProfile.brandColorSource}</p>
            <a href={selected.website} target="_blank" rel="noreferrer" style={{ color: 'var(--ff-primary)' }}>
              Open website
            </a>
          </div>
        )}
      </aside>
    </section>
  );
}
