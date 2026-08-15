/**
 * Live vehicle map. Fetches `/api/fleet/positions/live` every 30s.
 *
 * Only ~7 of 22 active vehicles are reachable today — the rest are blocked
 * on tracker API access we don't have. The endpoint returns every active
 * vehicle with an explicit trackingState, so this page must say so plainly
 * rather than silently drawing the handful it can plot.
 */
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { FleetMapLegend } from '@/modules/fleet/components/FleetMapLegend';
import type { OperationalProjectOption } from '@/modules/fleet/operations/projectScope';
import {
  MapAttentionPanel,
} from '@/modules/fleet/operations/web/MapAttentionPanel';
import {
  filterOperationalOverlay,
  reconcileOperationalOverlay,
} from '@/modules/fleet/operations/web/mapOverlayFilters';
import { MapOperationsToolbar } from '@/modules/fleet/operations/web/MapOperationsToolbar';
import {
  OperationsPresentationApiError,
  operationsPresentationApi,
} from '@/modules/fleet/operations/web/operationsPresentationApi';
import { useFleetMapLayers } from '@/modules/fleet/operations/web/useFleetMapLayers';
import { useMapOperationFilters } from '@/modules/fleet/operations/web/useMapOperationFilters';
import {
  notPlottedReason,
  partitionVehicles,
  statusFor,
  type VehicleStatus,
} from '@/modules/fleet/utils/liveMapHelpers';

const FleetMap = dynamic(() => import('@/modules/fleet/components/FleetMap'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm">Loading map…</div>,
});

export default function FleetMapPage() {
  const { change, currentFilters, filters, initialized } = useMapOperationFilters();
  const [projects, setProjects] = useState<OperationalProjectOption[]>([]);
  const [projectOptionsError, setProjectOptionsError] = useState(false);
  const [focusRequest, setFocusRequest] = useState({ staffId: null as string | null, id: 0 });
  const layers = useFleetMapLayers(filters);
  const vehicles = layers.telemetry.data?.vehicles ?? [];

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    const controller = new AbortController();
    setProjectOptionsError(false);
    void operationsPresentationApi.projectOptions(controller.signal).then((options) => {
      if (!active) return;
      setProjectOptionsError(false);
      setProjects(options);
      const current = currentFilters.current;
      const valid = options.some((project) => project.id === current.projectId);
      const projectId = valid ? current.projectId : options[0]?.id ?? current.projectId;
      if (projectId !== current.projectId) change({ ...current, projectId }, true);
    }).catch((error: unknown) => {
      if (!active) return;
      const permission = error instanceof OperationsPresentationApiError && error.kind === 'permission';
      if (permission) setProjects([]);
      setProjectOptionsError(!permission);
    });
    return () => { active = false; controller.abort(); };
  }, [change, currentFilters, initialized]);

  useEffect(() => {
    if (layers.overlay.error?.kind !== 'permission') return;
    const current = currentFilters.current;
    if (current.staffId || current.siteId) {
      change({ ...current, staffId: undefined, siteId: undefined }, true);
    }
  }, [change, currentFilters, layers.overlay.error]);

  const visibleOverlay = layers.overlay.data
    ? filterOperationalOverlay(reconcileOperationalOverlay(layers.overlay.data, vehicles), filters) : undefined;
  const showOperations = (filters.visibility ?? 'all') !== 'vehicles';
  const selectStaff = useCallback((staffId: string) => {
    change({ ...currentFilters.current, staffId });
    setFocusRequest((request) => ({ staffId, id: request.id + 1 }));
  }, [change, currentFilters]);

  const { plotted, notPlotted } = partitionVehicles(vehicles);
  // Counted from the plotted set only — the legend describes what is on the
  // map, and the not-plotted vehicles are already listed separately below it.
  const statusCounts = plotted.reduce<Partial<Record<VehicleStatus, number>>>((acc, v) => {
    const s = statusFor(v);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppLayout>
      {/*
       * AppLayout's <main> is already exactly the viewport minus the header,
       * module nav and footer, so the panel fills it by pinning to its edges
       * rather than subtracting that chrome from 100vh a second time. The old
       * `h-[calc(100vh-280px)]` (inherited from KanbanBoard/ChatTab, which sit
       * under a taller page header than this page has) left 115px dead above
       * the footer, and no constant fixes it properly: measured across
       * breakpoints the chrome is 157–173px because the header shrinks and the
       * footer wraps, and <main> additionally gains 40px of padding while an
       * admin impersonates — which a 100vh constant cannot see, so it overflows
       * into a scrollbar that fights the map's own pan.
       *
       * Pinning spans <main>'s border box, which ignores its padding, so the
       * safe-area inset it reserves at the bottom for the home indicator has to
       * be reapplied here — otherwise the map and the "not on the map" list sit
       * in the gesture strip on a notched phone. It resolves to 0 elsewhere.
       * <main>'s impersonation-only top padding is deliberately not mirrored:
       * <main> already starts below the header and module nav, well clear of
       * the fixed banner that padding exists to avoid.
       *
       * This relies on <main> keeping `relative` (AppLayout.tsx). If that is
       * dropped the panel resolves against the viewport and covers the app —
       * loud rather than silent, but it is why the two belong together.
       */}
      <div className="absolute inset-x-0 top-0 bottom-[env(safe-area-inset-bottom)] flex flex-col min-h-[500px]">
        <header className="px-4 py-3 border-b">
          <h1 className="text-lg font-semibold">Fleet map</h1>
          <p className="text-sm text-gray-500">
            Showing {plotted.length} of {vehicles.length} active vehicles.
            {notPlotted.length > 0 && ` ${notPlotted.length} not on the map.`} Positions refresh
            every 30 seconds and are typically 1–5 minutes behind.
          </p>
          <MapOperationsToolbar filters={filters} onChange={change} overlay={layers.overlay}
            projectOptionsError={projectOptionsError} projects={projects} telemetry={layers.telemetry} />
          <div className="mt-2">
            <FleetMapLegend counts={statusCounts} />
          </div>
        </header>
        <div className="relative flex-1 min-h-0">
          <FleetMap vehicles={vehicles} operationalOverlay={showOperations ? visibleOverlay : undefined}
            focusRequestId={focusRequest.id} focusStaffId={focusRequest.staffId}
            onStaffSelect={selectStaff} selectedStaffId={filters.staffId ?? null}
            showVehicleMarkers={(filters.visibility ?? 'all') !== 'drivers'} />
          {showOperations && visibleOverlay && <MapAttentionPanel filters={filters}
            operationalOverlay={visibleOverlay} onFocusStaff={selectStaff}
            selectedStaffId={filters.staffId ?? null} />}
        </div>
        {notPlotted.length > 0 && (
          <aside className="px-4 py-2 border-t text-sm">
            <strong>Not on the map:</strong>{' '}
            {notPlotted.map((v) => `${v.registration} (${notPlottedReason(v)})`).join(', ')}
          </aside>
        )}
      </div>
    </AppLayout>
  );
}
