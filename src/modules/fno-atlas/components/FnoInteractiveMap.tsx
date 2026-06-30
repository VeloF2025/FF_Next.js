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
  featureKind: 'coverage' | 'presence' | 'route' | 'project_aoi';
  pointCount: number | null;
  sourceLabel: string | null;
};
type CoverageFeature = Feature<Geometry, CoverageProperties>;
type CoverageFeatureCollection = FeatureCollection<Geometry, CoverageProperties>;

interface FnoInteractiveMapProps {
  networks: FnoNetwork[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

function polygonStyle(feature?: CoverageFeature): PathOptions {
  const color = feature?.properties.brandColor || fallbackPolygonColor;
  if (feature?.properties.featureKind === 'route') {
    return {
      color: '#22d3ee',
      fillOpacity: 0,
      opacity: 1,
      weight: 4.5,
      dashArray: '8 3',
    };
  }
  if (feature?.properties.featureKind === 'project_aoi') {
    return {
      color: '#f59e0b',
      fillColor: '#f59e0b',
      fillOpacity: 0.24,
      opacity: 0.95,
      weight: 2.4,
      dashArray: '10 4',
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
  if (kind === 'project_aoi') return 'Velocity AOI';
  return 'Coverage polygon';
}

function bindCoveragePopup(feature: CoverageFeature, layer: Layer): void {
  const name = feature.properties.areaName || featureKindLabel(feature.properties.featureKind);
  const label = featureKindLabel(feature.properties.featureKind);
  const sourceLabel = feature.properties.sourceLabel ? `<br/>${feature.properties.sourceLabel}` : '';
  const pointCount = feature.properties.pointCount ? `<br/>GPS records used: ${feature.properties.pointCount}` : '';
  layer.bindPopup(
    `<strong>${feature.properties.operatorName}</strong><br/>${name}<br/>${label}: ${feature.properties.rolloutStatus} · ${feature.properties.networkType}<br/>Confidence: ${feature.properties.confidence}${pointCount}${sourceLabel}`,
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

export function FnoInteractiveMap({ networks, selectedIds, onToggle }: FnoInteractiveMapProps) {
  const [coverage, setCoverage] = useState<CoverageFeatureCollection | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedNetworks = useMemo(
    () => networks.filter((network) => selectedIdSet.has(network.id)),
    [networks, selectedIdSet],
  );
  const primarySelected = selectedNetworks[0];
  const primarySelectedProfile = primarySelected ? getBrandProfile(primarySelected.id) : undefined;
  const legendItems: FnoLegendItem[] = networks
    .map((network) => ({ network, profile: getBrandProfile(network.id) }))
    .filter((item): item is FnoLegendItem => Boolean(item.profile));
  const visibleCoverage = useMemo<CoverageFeatureCollection | null>(() => {
    if (!coverage || selectedIdSet.size === 0) return coverage;
    return {
      type: 'FeatureCollection',
      features: coverage.features.filter((feature) => selectedIdSet.has(feature.properties.operatorSlug)),
    };
  }, [coverage, selectedIdSet]);
  const selectedSourceFeatureCount = visibleCoverage?.features.length ?? 0;
  const featureCountsByOperator = useMemo(() => {
    const counts = new Map<string, number>();
    coverage?.features.forEach((feature) => {
      counts.set(feature.properties.operatorSlug, (counts.get(feature.properties.operatorSlug) ?? 0) + 1);
    });
    return counts;
  }, [coverage]);

  useEffect(() => {
    let cancelled = false;
    if (selectedIds.length === 0) {
      setCoverage({ type: 'FeatureCollection', features: [] });
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      selectedIds.map(async (id) => {
        const params = new URLSearchParams({ operatorSlug: id, limit: id === 'dfa' ? '12000' : '5000' });
        if (id === 'fibertime') params.set('featureKinds', 'project_aoi');
        const response = await fetch(`/api/fno-atlas/coverage-geometry?${params.toString()}`);
        if (!response.ok) throw new Error(`Coverage geometry failed for ${id} (${response.status})`);
        return response.json() as Promise<{ data: CoverageFeatureCollection }>;
      }),
    )
      .then((payloads) => {
        if (!cancelled) {
          setCoverage({
            type: 'FeatureCollection',
            features: payloads.flatMap((payload) => payload.data.features),
          });
          setCoverageError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setCoverageError(error instanceof Error ? error.message : 'Coverage geometry failed');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedIds]);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="overflow-hidden rounded-2xl border shadow-sm" style={cardStyle}>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--ff-border-subtle)' }}>
          <div>
            <h2 className="text-xl font-semibold">Interactive FNO coverage map</h2>
            <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
              Select one or more FNOs to overlay source-backed coverage polygons, Velocity AOI areas, backhaul routes, and presence markers.
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
              const active = selectedIdSet.has(network.id);
              return (
                <button
                  key={network.id}
                  type="button"
                  onClick={() => onToggle(network.id)}
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
          {selectedNetworks.length > 0 && selectedSourceFeatureCount === 0 && (
            <div className="pointer-events-none absolute left-4 top-4 z-[1000] max-w-xs rounded-xl border px-3 py-2 text-xs shadow-sm" style={cardStyle}>
              No source-backed polygons, AOI areas, routes, or presence markers imported for the selected FNOs yet.
            </div>
          )}
        </MapContainer>
      </div>

      <aside className="rounded-2xl border p-4 shadow-sm" style={cardStyle}>
        <h3 className="text-lg font-semibold">FNO colour key</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
          Polygons show official/source-backed FNO coverage, amber dashed fills show Velocity AOI areas, cyan dashed lines show routes, and circles show official presence markers. Click FNOs to add/remove overlays.
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
          {selectedNetworks.length} selected · {selectedSourceFeatureCount} visible source-backed features
        </p>
        <div className="mt-4 max-h-[470px] space-y-2 overflow-y-auto pr-1">
          {legendItems.map(({ network, profile }) => {
            const active = selectedIdSet.has(network.id);
            const featureCount = featureCountsByOperator.get(network.id) ?? 0;
            return (
              <button
                key={network.id}
                type="button"
                onClick={() => onToggle(network.id)}
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
                    {active && featureCount > 0
                      ? `${featureCount} visible feature${featureCount === 1 ? '' : 's'}`
                      : `${profile.brandColorLabel} · ${profile.mapPoints.length} reference point${profile.mapPoints.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {primarySelected && primarySelectedProfile && (
          <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: primarySelectedProfile.brandColor }}>
            <p className="font-semibold">
              {selectedNetworks.length === 1 ? primarySelected.name : `${selectedNetworks.length} FNO overlays selected`}
            </p>
            <p className="mt-1" style={{ color: 'var(--ff-text-secondary)' }}>{primarySelectedProfile.brandColorSource}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <a href={primarySelected.website} target="_blank" rel="noreferrer" style={{ color: 'var(--ff-primary)' }}>
                Open website
              </a>
              {selectedNetworks.length === 1 && (
                <a
                  href={`/api/fno-atlas/coverage-kml?operatorSlug=${encodeURIComponent(primarySelected.id)}&limit=all`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--ff-primary)' }}
                >
                  Download KML
                </a>
              )}
            </div>
          </div>
        )}
      </aside>
    </section>
  );
}
