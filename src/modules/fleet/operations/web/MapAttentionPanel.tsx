import Link from 'next/link';
import { useState } from 'react';
import type { OperationalStatus } from '../types';
import type { OperationFilters } from './operationFilters';
import {
  evidenceForMapItem,
  mapAttentionItems,
  matchesMapFilters,
  type MapAttentionItem,
  type OperationalMapDisplayOverlay,
} from './mapOverlayFilters';

const ACTIONABLE = new Set<OperationalStatus>([
  'late', 'wrong_site', 'evidence_mismatch', 'left_early', 'unassigned', 'unverifiable',
  'vehicle_on_site_driver_unconfirmed',
]);
/** Only these four PR6 auto-produced incident types share their name with an `OperationalStatus` value; every other status is summary-only and gets no incident deep link. */
const INCIDENT_PRODUCING_STATUSES = new Set<OperationalStatus>(['late', 'wrong_site', 'evidence_mismatch', 'left_early']);

function incidentsHref(item: MapAttentionItem, filters: OperationFilters): string | null {
  if (!INCIDENT_PRODUCING_STATUSES.has(item.row.status)) return null;
  const query = new URLSearchParams();
  query.set('incidentType', item.row.status);
  const projectId = item.row.projectId ?? filters.projectId;
  if (projectId) query.set('projectId', projectId);
  query.set('staffId', item.row.staffId);
  return `/fleet/incidents?${query.toString()}`;
}
const STATUS_LABELS: Record<OperationalStatus, string> = {
  off_duty: 'Off duty', scheduled_not_due: 'Scheduled, not due', unassigned: 'Unassigned',
  unverifiable: 'Unverifiable', late: 'Late', approaching: 'Approaching',
  attendance_confirmed: 'Attendance confirmed',
  vehicle_on_site_driver_unconfirmed: 'Vehicle on site — driver unconfirmed',
  on_site_dual: 'On site', wrong_site: 'Wrong site', evidence_mismatch: 'Evidence mismatch',
  left_early: 'Left early', shift_complete: 'Shift complete',
};

function EvidenceText({ item }: { item: MapAttentionItem }) {
  if (item.kind === 'attendance') return <p className="text-xs">{item.row.label}</p>;
  if (item.kind === 'unplottable') {
    return <p className="text-xs">{item.row.reason === 'vehicle_telemetry_unavailable'
      ? 'Vehicle telemetry is unavailable; this person is not plotted.'
      : 'No permissible location evidence; this person is not plotted.'}</p>;
  }
  return <p className="text-xs">{evidenceForMapItem(item).replaceAll('_', ' ')} evidence</p>;
}

function AttentionRows({ items, selectedStaffId, onFocusStaff, filters }: {
  items: MapAttentionItem[];
  selectedStaffId: string | null;
  onFocusStaff: (staffId: string) => void;
  filters: OperationFilters;
}) {
  if (!items.length) return <p className="p-3 text-sm">No staff currently need attention.</p>;
  return <div className="divide-y overflow-y-auto">{items.map((item) => {
    const href = incidentsHref(item, filters);
    return (
      <div key={item.row.staffId} className="flex items-center justify-between gap-2 p-3">
        <button type="button" aria-label={`Focus ${item.row.staffName} on map`}
          aria-pressed={item.row.staffId === selectedStaffId} onClick={() => onFocusStaff(item.row.staffId)}
          className="min-w-0 flex-1 text-left focus:outline-none focus:ring-2 focus:ring-blue-500">
          <span className="font-medium">{item.row.staffName}</span>
          <span className="ml-2 rounded bg-secondary text-secondary-foreground px-2 py-1 text-xs">{STATUS_LABELS[item.row.status]}</span>
          <EvidenceText item={item} />
        </button>
        {href && <Link href={href} aria-label={`View incidents for ${item.row.staffName}`} className="shrink-0 rounded border px-2 py-1 text-xs">Incidents</Link>}
      </div>
    );
  })}</div>;
}

/**
 * The server truncates the underlying roster fetch at `limit` (page 1, 100)
 * before this panel ever sees it — `operationalOverlay` is already the
 * client-filtered/reconciled view and can't tell truncation apart from a
 * user filter excluding rows. The caller must pass the raw fetch's
 * `hasMore`/`total` through separately so the panel can say so honestly.
 */
export interface MapAttentionTruncation { shown: number; total: number }

function TruncationNotice({ truncated }: { truncated: MapAttentionTruncation }) {
  return (
    <p className="border-b bg-amber-50 p-2 text-xs font-medium text-amber-700">
      Showing {truncated.shown} of {truncated.total} eligible staff — {truncated.total - truncated.shown} more not shown. Narrow the filters to see them.
    </p>
  );
}

export interface MapAttentionPanelProps {
  operationalOverlay: OperationalMapDisplayOverlay;
  selectedStaffId: string | null;
  onFocusStaff: (staffId: string) => void;
  filters?: OperationFilters;
  truncated?: MapAttentionTruncation;
}

export function MapAttentionPanel({
  operationalOverlay, selectedStaffId, onFocusStaff, filters = {}, truncated,
}: MapAttentionPanelProps) {
  const [desktopExpanded, setDesktopExpanded] = useState(true);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const filtered = mapAttentionItems(operationalOverlay).filter((item) => matchesMapFilters(item, filters));
  const hasExplicitFilter = Boolean(filters.status || filters.group || filters.evidence);
  const attention = hasExplicitFilter ? filtered : filtered.filter((item) => ACTIONABLE.has(item.row.status));
  const isTruncated = Boolean(truncated && truncated.shown < truncated.total);
  return (
    <>
      <div data-testid="map-attention-desktop" className="absolute right-3 top-3 z-[500] hidden max-h-[calc(100%-1.5rem)] w-80 lg:block">
        {desktopExpanded ? <aside aria-label="Map attention" className="flex max-h-full flex-col rounded-lg border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b p-3"><strong>Needs attention ({attention.length})</strong>
            <button type="button" aria-expanded="true" aria-label="Collapse attention panel"
              onClick={() => setDesktopExpanded(false)}>Collapse</button></div>
          {isTruncated && truncated && <TruncationNotice truncated={truncated} />}
          <AttentionRows items={attention} selectedStaffId={selectedStaffId} onFocusStaff={onFocusStaff} filters={filters} />
        </aside> : <button type="button" aria-expanded="false" aria-label="Expand attention panel"
          onClick={() => setDesktopExpanded(true)} className="rounded border bg-card px-3 py-2 shadow">Attention ({attention.length})</button>}
      </div>
      <div data-testid="map-attention-mobile" className="absolute inset-x-3 bottom-3 z-[500] lg:hidden">
        <section aria-label="Mobile map attention" className="rounded-t-lg border bg-card shadow-lg">
          <button type="button" aria-expanded={mobileExpanded}
            aria-label={`${mobileExpanded ? 'Collapse' : 'Expand'} mobile attention sheet`}
            onClick={() => setMobileExpanded((value) => !value)} className="w-full p-3 text-left font-medium">
            Needs attention ({attention.length})
          </button>
          {mobileExpanded && <div className="max-h-64 overflow-y-auto">
            {isTruncated && truncated && <TruncationNotice truncated={truncated} />}
            <AttentionRows items={attention} selectedStaffId={selectedStaffId} onFocusStaff={onFocusStaff} filters={filters} />
          </div>}
        </section>
      </div>
    </>
  );
}
