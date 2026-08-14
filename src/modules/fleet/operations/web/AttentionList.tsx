import Link from 'next/link';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { OperationalAttentionRow } from '../presentationTypes';
import type { OperationalStatus } from '../types';
import { serializeOperationFilters, type OperationFilters } from './operationFilters';

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
  if (filters.workDate) { query.set('from', filters.workDate); query.set('to', filters.workDate); }
  return `/fleet/assignments?${query.toString()}`;
}

interface AttentionListProps {
  rows: OperationalAttentionRow[];
  filters: OperationFilters;
  onOpenEvidence: (row: OperationalAttentionRow, opener: HTMLElement) => void;
}

export function AttentionList({ rows, filters, onOpenEvidence }: AttentionListProps) {
  const stop = (event: MouseEvent<HTMLElement>) => event.stopPropagation();
  const openFromRow = (row: OperationalAttentionRow, target: HTMLElement) => onOpenEvidence(row, target);
  const keyOpen = (event: KeyboardEvent<HTMLElement>, row: OperationalAttentionRow) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFromRow(row, event.currentTarget);
  };
  return (
    <div className="divide-y divide-[var(--ff-border-light)]">
      {rows.map((row) => (
        <article
          key={row.staffId}
          data-testid={`attention-row-${row.status}`}
          tabIndex={0}
          onClick={(event) => openFromRow(row, event.currentTarget)}
          onKeyDown={(event) => keyOpen(event, row)}
          className="flex cursor-pointer flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
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
          </div>
          <div className="flex flex-wrap gap-2" onClick={stop}>
            <button type="button" onClick={(event) => onOpenEvidence(row, event.currentTarget)}
              className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">
              <span className="sr-only">View evidence for {row.staffName}</span><span aria-hidden="true">View evidence</span>
            </button>
            <Link href={mapHref(row, filters)} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">View on map</Link>
            <Link href={assignmentHref(row, filters)} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">Manage assignment</Link>
          </div>
        </article>
      ))}
    </div>
  );
}
