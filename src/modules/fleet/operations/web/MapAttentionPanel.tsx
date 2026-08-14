import { useState } from 'react';
import type { OperationalMapOverlay } from '../mapOverlayService';
import type { OperationalStatus } from '../types';
import type { OperationFilters } from './operationFilters';
import {
  evidenceForMapItem,
  mapAttentionItems,
  matchesMapFilters,
  type MapAttentionItem,
} from './mapOverlayFilters';

const ACTIONABLE = new Set<OperationalStatus>([
  'late', 'wrong_site', 'evidence_mismatch', 'left_early', 'unassigned', 'unverifiable',
  'vehicle_on_site_driver_unconfirmed',
]);
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
    return <p className="text-xs">No permissible location evidence; this person is not plotted.</p>;
  }
  return <p className="text-xs">{evidenceForMapItem(item).replaceAll('_', ' ')} evidence</p>;
}

function AttentionRows({ items, selectedStaffId, onFocusStaff }: {
  items: MapAttentionItem[];
  selectedStaffId: string | null;
  onFocusStaff: (staffId: string) => void;
}) {
  if (!items.length) return <p className="p-3 text-sm">No staff currently need attention.</p>;
  return <div className="divide-y overflow-y-auto">{items.map((item) => (
    <button key={item.row.staffId} type="button" aria-label={`Focus ${item.row.staffName} on map`}
      aria-pressed={item.row.staffId === selectedStaffId} onClick={() => onFocusStaff(item.row.staffId)}
      className="block w-full p-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-500">
      <span className="font-medium">{item.row.staffName}</span>
      <span className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs">{STATUS_LABELS[item.row.status]}</span>
      <EvidenceText item={item} />
    </button>
  ))}</div>;
}

export interface MapAttentionPanelProps {
  operationalOverlay: OperationalMapOverlay;
  selectedStaffId: string | null;
  onFocusStaff: (staffId: string) => void;
  filters?: OperationFilters;
}

export function MapAttentionPanel({
  operationalOverlay, selectedStaffId, onFocusStaff, filters = {},
}: MapAttentionPanelProps) {
  const [desktopExpanded, setDesktopExpanded] = useState(true);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const filtered = mapAttentionItems(operationalOverlay).filter((item) => matchesMapFilters(item, filters));
  const hasExplicitFilter = Boolean(filters.status || filters.group || filters.evidence);
  const attention = hasExplicitFilter ? filtered : filtered.filter((item) => ACTIONABLE.has(item.row.status));
  return (
    <>
      <div data-testid="map-attention-desktop" className="absolute right-3 top-3 z-[500] hidden max-h-[calc(100%-1.5rem)] w-80 lg:block">
        {desktopExpanded ? <aside aria-label="Map attention" className="flex max-h-full flex-col rounded-lg border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b p-3"><strong>Needs attention ({attention.length})</strong>
            <button type="button" aria-expanded="true" aria-label="Collapse attention panel"
              onClick={() => setDesktopExpanded(false)}>Collapse</button></div>
          <AttentionRows items={attention} selectedStaffId={selectedStaffId} onFocusStaff={onFocusStaff} />
        </aside> : <button type="button" aria-expanded="false" aria-label="Expand attention panel"
          onClick={() => setDesktopExpanded(true)} className="rounded border bg-white px-3 py-2 shadow">Attention ({attention.length})</button>}
      </div>
      <div data-testid="map-attention-mobile" className="absolute inset-x-3 bottom-3 z-[500] lg:hidden">
        <section aria-label="Mobile map attention" className="rounded-t-lg border bg-white shadow-lg">
          <button type="button" aria-expanded={mobileExpanded}
            aria-label={`${mobileExpanded ? 'Collapse' : 'Expand'} mobile attention sheet`}
            onClick={() => setMobileExpanded((value) => !value)} className="w-full p-3 text-left font-medium">
            Needs attention ({attention.length})
          </button>
          {mobileExpanded && <div className="max-h-64 overflow-y-auto"><AttentionRows items={attention}
            selectedStaffId={selectedStaffId} onFocusStaff={onFocusStaff} /></div>}
        </section>
      </div>
    </>
  );
}
