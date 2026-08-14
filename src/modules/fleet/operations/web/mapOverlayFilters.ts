import type {
  OperationalAttendancePoint,
  OperationalBadgeRow,
  OperationalMapOverlay,
  OperationalUnplottableRow,
} from '../mapOverlayService';
import { groupForOperationalStatus } from '../overviewService';
import type { OperationEvidenceFilter, OperationFilters } from './operationFilters';

export type MapAttentionItem =
  | { kind: 'badge'; row: OperationalBadgeRow }
  | { kind: 'attendance'; row: OperationalAttendancePoint }
  | { kind: 'unplottable'; row: OperationalUnplottableRow };

export function evidenceForMapItem(item: MapAttentionItem): OperationEvidenceFilter {
  if (item.kind === 'attendance') return 'attendance_only';
  if (item.kind === 'unplottable') return 'missing';
  const flags = new Set(item.row.flags);
  if (flags.has('gps_stale')) return 'stale';
  if (flags.has('evidence_source_error')) return 'missing';
  if (flags.has('gps_missing') && flags.has('attendance_missing')) return 'missing';
  if (flags.has('attendance_missing') || flags.has('vehicle_driver_presence_unconfirmed')) return 'vehicle_only';
  if (flags.has('gps_missing') || flags.has('no_assigned_vehicle')) return 'attendance_only';
  return 'dual';
}

export function matchesMapFilters(item: MapAttentionItem, filters: OperationFilters): boolean {
  return (!filters.status || item.row.status === filters.status)
    && (!filters.group || groupForOperationalStatus(item.row.status) === filters.group)
    && (!filters.evidence || evidenceForMapItem(item) === filters.evidence);
}

export function mapAttentionItems(overlay: OperationalMapOverlay): MapAttentionItem[] {
  return [
    ...overlay.badges.map((row): MapAttentionItem => ({ kind: 'badge', row })),
    ...overlay.attendancePoints.map((row): MapAttentionItem => ({ kind: 'attendance', row })),
    ...overlay.unplottable.map((row): MapAttentionItem => ({ kind: 'unplottable', row })),
  ];
}

export function filterOperationalOverlay(
  overlay: OperationalMapOverlay,
  filters: OperationFilters,
): OperationalMapOverlay {
  const included = mapAttentionItems(overlay).filter((item) => matchesMapFilters(item, filters));
  return {
    ...overlay,
    badges: included.flatMap((item) => item.kind === 'badge' ? [item.row] : []),
    attendancePoints: included.flatMap((item) => item.kind === 'attendance' ? [item.row] : []),
    unplottable: included.flatMap((item) => item.kind === 'unplottable' ? [item.row] : []),
    total: included.length,
    hasMore: false,
  };
}
