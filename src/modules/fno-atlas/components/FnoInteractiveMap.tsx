import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { circleMarker } from 'leaflet';
import type { Layer, LatLng, PathOptions } from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet';
import type { FnoNetwork } from '../data/fnoAtlasData';
import { getBrandProfile } from '../data/fnoBrandMapData';
import type { LatLngTuple } from '../data/fnoBrandMapData';

const SOUTH_AFRICA_CENTER: LatLngTuple = [-29.0, 24.0];
const cardStyle = { backgroundColor: 'var(--ff-surface)', borderColor: 'var(--ff-border-subtle)' };
const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileAttribution = '&copy; OpenStreetMap contributors';
const fallbackPolygonColor = '#2563eb';

type FnoLegendItem = {
  network: FnoNetwork;
  profile: NonNullable<ReturnType<typeof getBrandProfile>>;
};

type CoverageProperties = {
  operatorSlug: string;
  operatorName: string;
  brandColor: string | null;
  areaName: string | null;
  rolloutStatus: string;
  networkType: string;
  confidence: string;
  featureKind: 'coverage' | 'presence' | 'route';
};
type CoverageFeature = Feature<Geometry, CoverageProperties>;
type CoverageFeatureCollection = FeatureCollection<Geometry, CoverageProperties>;

interface FnoInteractiveMapProps {
  networks: FnoNetwork[];
  selectedId: string;
  onSelect: (id: string) => void;
}

function polygonStyle(feature?: CoverageFeature): PathOptions {
  const color = feature?.properties.brandColor || fallbackPolygonColor;
  if (feature?.properties.featureKind === 'route') {
    return {
      color,
      fillOpacity: 0,
      opacity: 1,
      weight: 3.5,
      dashArray: '7 4',
    };
  }
  return {
    color,
    fillColor: color,
    fillOpacity: 0.16,
    opacity: 0.75,
    weight: 1.6,
  };
}

function featureKindLabel(kind: CoverageProperties['featureKind']): string {
  if (kind === 'presence') return 'Presence point';
  if (kind === 'route') return 'Backhaul route';
  return 'Coverage polygon';
}

function bindCoveragePopup(feature: CoverageFeature, layer: Layer): void {
  const name = feature.properties.areaName || featureKindLabel(feature.properties.featureKind);
  const label = featureKindLabel(feature.properties.featureKind);
  layer.bindPopup(
    `<strong>${feature.properties.operatorName}</strong><br/>${name}<br/>${label}: ${feature.properties.rolloutStatus} · ${feature.properties.networkType}<br/>Confidence: ${feature.properties.confidence}`,
  );
  layer.bindTooltip(`${feature.properties.operatorName} · ${name}`, { sticky: true });
}

function coveragePointToLayer(feature: CoverageFeature, latlng: LatLng): Layer {
  const color = feature.properties.brandColor || fallbackPolygonColor;
  return circleMarker(latlng, {
    color,
    fillColor: color,
    fillOpacity: 0.86,
    opacity: 0.95,
    radius: 7,
    weight: 2.5,
  });
}

export function FnoInteractiveMap({ networks, selectedId, onSelect }: FnoInteractiveMapProps) {
  const [coverage, setCoverage] = useState<CoverageFeatureCollection | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const selected = networks.find((network) => network.id === selectedId) ?? networks[0];
  const selectedProfile = selected ? getBrandProfile(selected.id) : undefined;
  const legendItems: FnoLegendItem[] = networks
    .map((network) => ({ network, profile: getBrandProfile(network.id) }))
    .filter((item): item is FnoLegendItem => Boolean(item.profile));
  const visibleCoverage = useMemo<CoverageFeatureCollection | null>(() => {
    if (!coverage || !selected) return coverage;
    return {
      type: 'FeatureCollection',
      features: coverage.features.filter((feature) => feature.properties.operatorSlug === selected.id),
    };
  }, [coverage, selected]);
  const selectedSourceFeatureCount = visibleCoverage?.features.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ operatorSlug: selected?.id || '', limit: selected?.id === 'dfa' ? '12000' : '5000' });
    fetch(`/api/fno-atlas/coverage-geometry?${params.toString()}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Coverage geometry failed (${response.status})`);
        return response.json() as Promise<{ data: CoverageFeatureCollection }>;
      })
      .then((payload) => {
        if (!cancelled) setCoverage(payload.data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCoverageError(error instanceof Error ? error.message : 'Coverage geometry failed');
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="overflow-hidden rounded-2xl border shadow-sm" style={cardStyle}>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--ff-border-subtle)' }}>
          <div>
            <h2 className="text-xl font-semibold">Interactive FNO coverage map</h2>
            <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
              Source-backed coverage polygons, backhaul routes, and presence points; tap a colour key item to isolate an FNO.
            </p>
            {coverageError && <p className="mt-1 text-xs" style={{ color: 'var(--ff-error)' }}>{coverageError}</p>}
          </div>
          <span className="w-fit rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'var(--ff-surface-alt)', color: 'var(--ff-text-secondary)' }}>
            OpenStreetMap
          </span>
        </div>

        <div className="border-b p-3 xl:hidden" style={{ borderColor: 'var(--ff-border-subtle)' }}>
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="FNO colour key">
            {legendItems.map(({ network, profile }) => {
              const active = selected?.id === network.id;
              return (
                <button
                  key={network.id}
                  type="button"
                  onClick={() => onSelect(network.id)}
                  className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium"
                  style={{
                    borderColor: active ? profile.brandColor : 'var(--ff-border-subtle)',
                    backgroundColor: active ? 'var(--ff-surface-alt)' : 'var(--ff-surface)',
                    color: 'var(--ff-text-primary)',
                  }}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: profile.brandColor }} />
                  {network.name}
                </button>
              );
            })}
          </div>
        </div>

        <MapContainer center={SOUTH_AFRICA_CENTER} zoom={5} scrollWheelZoom className="h-[440px] w-full sm:h-[560px]">
          <TileLayer attribution={tileAttribution} detectRetina maxZoom={18} url={tileUrl} />
          {visibleCoverage && (
            <GeoJSON
              key={`${selected?.id ?? 'all'}-${visibleCoverage.features.length}`}
              data={visibleCoverage}
              style={polygonStyle}
              pointToLayer={coveragePointToLayer}
              onEachFeature={bindCoveragePopup}
            />
          )}
          {selected && selectedSourceFeatureCount === 0 && (
            <div className="pointer-events-none absolute left-4 top-4 z-[1000] max-w-xs rounded-xl border px-3 py-2 text-xs shadow-sm" style={cardStyle}>
              No source-backed polygons, routes, or presence points imported for {selected.name} yet.
            </div>
          )}
        </MapContainer>
      </div>

      <aside className="rounded-2xl border p-4 shadow-sm" style={cardStyle}>
        <h3 className="text-lg font-semibold">FNO colour key</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
          Polygons show source-backed coverage, dashed lines show imported backhaul/routes, and circles show presence points.
        </p>
        <div className="mt-4 max-h-[470px] space-y-2 overflow-y-auto pr-1">
          {legendItems.map(({ network, profile }) => {
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
                    {selected?.id === network.id && selectedSourceFeatureCount > 0
                      ? `${selectedSourceFeatureCount} source-backed feature${selectedSourceFeatureCount === 1 ? '' : 's'}`
                      : `${profile.brandColorLabel} · ${profile.mapPoints.length} reference point${profile.mapPoints.length === 1 ? '' : 's'}`}
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
            <div className="mt-2 flex flex-wrap gap-3">
              <a href={selected.website} target="_blank" rel="noreferrer" style={{ color: 'var(--ff-primary)' }}>
                Open website
              </a>
              <a
                href={`/api/fno-atlas/coverage-kml?operatorSlug=${encodeURIComponent(selected.id)}&limit=all`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--ff-primary)' }}
              >
                Download KML
              </a>
            </div>
          </div>
        )}
      </aside>
    </section>
  );
}
