import Link from 'next/link';
import type { OperationalAttentionRow } from '../presentationTypes';
import type { OperationalStatus } from '../types';
import { serializeOperationFilters, type OperationFilters } from './operationFilters';

/**
 * Only the four PR6 auto-produced incident types share their name with an
 * `OperationalStatus` value — everything else (unassigned/unverifiable/
 * vehicle_on_site_driver_unconfirmed/…) is summary-only and never opens an
 * incident, so it gets no "View incidents" deep link here.
 */
const INCIDENT_PRODUCING_STATUSES = new Set<OperationalStatus>(['late', 'wrong_site', 'evidence_mismatch', 'left_early']);

function incidentsHref(row: OperationalAttentionRow, filters: OperationFilters): string | null {
  if (!INCIDENT_PRODUCING_STATUSES.has(row.status)) return null;
  const query = new URLSearchParams();
  query.set('incidentType', row.status);
  const projectId = row.projectId ?? filters.projectId;
  if (projectId) query.set('projectId', projectId);
  query.set('staffId', row.staffId);
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

function mapHref(row: OperationalAttentionRow, filters: OperationFilters): string {
  const query = serializeOperationFilters({
    ...filters,
    projectId: row.projectId ?? filters.projectId,
    staffId: row.staffId,
  });
  return `/fleet/map?${query}`;
}

function assignmentHref(row: OperationalAttentionRow, filters: OperationFilters): string {
  const query = new URLSearchParams();
  if (row.projectId ?? filters.projectId) query.set('projectId', (row.projectId ?? filters.projectId)!);
  query.set('staffId', row.staffId);
  if (filters.workDate) query.set('workDate', filters.workDate);
  return `/fleet/assignments?${query.toString()}`;
}

interface AttentionListProps {
  rows: OperationalAttentionRow[];
  filters: OperationFilters;
  onOpenEvidence: (row: OperationalAttentionRow, opener: HTMLElement) => void;
}

export function AttentionList({ rows, filters, onOpenEvidence }: AttentionListProps) {
  return (
    <div className="divide-y divide-[var(--ff-border-light)]">
      {rows.map((row) => {
        // Computed once and reused, matching MapAttentionPanel. Calling it twice forced a
        // non-null assertion on the second call, because TypeScript cannot narrow one call's
        // result from another's truthiness check.
        const incidentsLink = incidentsHref(row, filters);
        return (
        <article
          key={row.staffId}
          data-testid={`attention-row-${row.status}`}
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <button type="button" aria-label={`View evidence for ${row.staffName}`}
            onClick={(event) => onOpenEvidence(row, event.currentTarget)} className="min-w-0 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-medium text-[var(--ff-text-primary)]">{row.staffName}</h4>
              <span className="rounded-full bg-[var(--ff-bg-tertiary)] px-2 py-1 text-xs text-[var(--ff-text-secondary)]">
                {STATUS_LABELS[row.status]}
              </span>
            </div>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {row.projectName ?? 'No project'} · {row.operationalSiteName ?? 'No expected site'}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{row.reasonText}</p>
            <p className="text-xs text-[var(--ff-text-tertiary)]">
              {row.evidenceLabel}{row.durationSeconds === null ? '' : ` · ${Math.round(row.durationSeconds / 60)} min`}
            </p>
          </button>
          <div className="flex flex-wrap gap-2">
            <Link href={mapHref(row, filters)} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">View on map</Link>
            <Link href={assignmentHref(row, filters)} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">Manage assignment</Link>
            {incidentsLink && (
              <Link href={incidentsLink} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">View incidents</Link>
            )}
          </div>
        </article>
        );
      })}
    </div>
  );
}
