/**
 * Live vehicle map. Fetches `/api/fleet/positions/live` every 30s.
 *
 * Only ~7 of 22 active vehicles are reachable today — the rest are blocked
 * on tracker API access we don't have. The endpoint returns every active
 * vehicle with an explicit trackingState, so this page must say so plainly
 * rather than silently drawing the handful it can plot.
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import { log } from '@/lib/logger';
import { notPlottedReason, partitionVehicles } from '@/modules/fleet/utils/liveMapHelpers';

const FleetMap = dynamic(() => import('@/modules/fleet/components/FleetMap'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm">Loading map…</div>,
});

const REFRESH_MS = 30_000;

interface LivePositionsResponse {
  success: true;
  data: { vehicles: LiveVehicle[]; staleAfterSeconds: number };
}

export default function FleetMapPage() {
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/fleet/positions/live');
        if (!res.ok) throw new Error(`Failed to load positions (${res.status})`);
        const body = (await res.json()) as LivePositionsResponse;
        if (!cancelled) {
          setVehicles(body.data.vehicles);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load positions');
        }
        log.error('[fleet/map] failed to load live positions', { error: err });
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const { plotted, notPlotted } = partitionVehicles(vehicles);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <header className="px-4 py-3 border-b">
        <h1 className="text-lg font-semibold">Fleet map</h1>
        <p className="text-sm text-gray-500">
          Showing {plotted.length} of {vehicles.length} active vehicles.
          {notPlotted.length > 0 && ` ${notPlotted.length} not on the map.`}
          {' '}
          Positions refresh every 30 seconds and are typically 1–5 minutes behind.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </header>
      <div className="flex-1 min-h-0">
        <FleetMap vehicles={vehicles} />
      </div>
      {notPlotted.length > 0 && (
        <aside className="px-4 py-2 border-t text-sm">
          <strong>Not on the map:</strong>{' '}
          {notPlotted.map((v) => `${v.registration} (${notPlottedReason(v)})`).join(', ')}
        </aside>
      )}
    </div>
  );
}
