/**
 * Live vehicle map. Fetches `/api/fleet/positions/live` every 30s.
 *
 * Only ~7 of 22 active vehicles are reachable today — the rest are blocked
 * on tracker API access we don't have. The endpoint returns every active
 * vehicle with an explicit trackingState, so this page must say so plainly
 * rather than silently drawing the handful it can plot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { FleetMapLegend } from '@/modules/fleet/components/FleetMapLegend';
import type { AssignmentOption } from '@/modules/fleet/assignments/rosterQueries';
import { assignmentApi, AssignmentApiError } from '@/modules/fleet/assignments/web/assignmentApi';
import {
  MapAttentionPanel,
} from '@/modules/fleet/operations/web/MapAttentionPanel';
import { filterOperationalOverlay } from '@/modules/fleet/operations/web/mapOverlayFilters';
import { MapOperationsToolbar } from '@/modules/fleet/operations/web/MapOperationsToolbar';
import {
  parseOperationFilters,
  serializeOperationFilters,
  type OperationFilters,
} from '@/modules/fleet/operations/web/operationFilters';
import { useFleetMapLayers } from '@/modules/fleet/operations/web/useFleetMapLayers';
import { isCurrentOperationDate } from '@/modules/fleet/operations/web/useOperationalOverview';
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

const FILTER_KEYS: Array<keyof OperationFilters> = [
  'projectId', 'staffId', 'siteId', 'workDate', 'asOf', 'status', 'group', 'evidence', 'visibility',
];

function sastDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function datedFilters(filters: OperationFilters, workDate: string, now = new Date()): OperationFilters {
  const asOf = isCurrentOperationDate(workDate, now)
    ? now.toISOString() : new Date(`${workDate}T23:59:59.999+02:00`).toISOString();
  return { ...filters, workDate, asOf, visibility: filters.visibility ?? 'all' };
}

function locationFilters(now = new Date()): OperationFilters {
  const source = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const known = new URLSearchParams();
  for (const key of FILTER_KEYS) for (const value of source.getAll(key)) known.append(key, value);
  try {
    const parsed = parseOperationFilters(known);
    return datedFilters(parsed, parsed.workDate ?? sastDate(now), now);
  } catch {
    return datedFilters({}, sastDate(now), now);
  }
}

function replaceLocation(filters: OperationFilters, replace: boolean): void {
  const query = serializeOperationFilters(filters);
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', next);
}

export default function FleetMapPage() {
  const [filters, setFilters] = useState<OperationFilters>(locationFilters);
  const currentFilters = useRef(filters);
  const [projects, setProjects] = useState<AssignmentOption[]>([]);
  const [projectOptionsError, setProjectOptionsError] = useState(false);
  const layers = useFleetMapLayers(filters);
  const vehicles = layers.telemetry.data?.vehicles ?? [];
  const change = useCallback((next: OperationFilters, replace = false) => {
    currentFilters.current = next;
    replaceLocation(next, replace);
    setFilters(next);
  }, []);

  useEffect(() => {
    replaceLocation(currentFilters.current, true);
    const navigate = () => {
      const next = locationFilters();
      currentFilters.current = next;
      replaceLocation(next, true);
      setFilters(next);
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);

  useEffect(() => {
    let active = true;
    setProjectOptionsError(false);
    const query = new URLSearchParams({ from: filters.workDate!, to: filters.workDate! }).toString();
    void assignmentApi.options(query).then((options) => {
      if (!active) return;
      setProjectOptionsError(false);
      setProjects(options.projects);
      const current = currentFilters.current;
      const valid = options.projects.some((project) => project.id === current.projectId);
      const projectId = valid ? current.projectId : options.projects[0]?.id ?? current.projectId;
      if (projectId !== current.projectId) change({ ...current, projectId }, true);
    }).catch((error: unknown) => {
      if (!active) return;
      const permission = error instanceof AssignmentApiError && (error.status === 401 || error.status === 403);
      if (permission) setProjects([]);
      setProjectOptionsError(!permission);
    });
    return () => { active = false; };
  }, [change, filters.workDate]);

  const visibleOverlay = layers.overlay.data
    ? filterOperationalOverlay(layers.overlay.data, filters) : undefined;
  const showOperations = (filters.visibility ?? 'all') !== 'vehicles';
  const selectStaff = (staffId: string) => change({ ...currentFilters.current, staffId });

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
