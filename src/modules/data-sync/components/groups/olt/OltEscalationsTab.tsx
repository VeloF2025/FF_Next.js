/**
 * OltEscalationsTab — read-only view of escalated records with date filter.
 */

'use client';

import type { OltRecord, OltStats, InvestigationContext, DateFilter } from '../../../types';
import { OltRecordTable } from './OltRecordTable';
import { DateChipFilter } from '../../DateChipFilter';

interface OltEscalationsTabProps {
  records: OltRecord[];
  stats: OltStats;
  isLoading: boolean;
  page: number;
  total: number;
  pageSize: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  isStatusMismatch: (record: OltRecord) => boolean;
  getInvestigationContext: (record: OltRecord) => InvestigationContext | null;
  dateFilter: DateFilter;
  customDateFrom: string;
  customDateTo: string;
  setDateFilter: (f: DateFilter) => void;
  setCustomDateFrom: (d: string) => void;
  setCustomDateTo: (d: string) => void;
}

export function OltEscalationsTab({
  records,
  stats,
  isLoading,
  page,
  total,
  pageSize,
  setPage,
  isStatusMismatch,
  getInvestigationContext,
  dateFilter,
  customDateFrom,
  customDateTo,
  setDateFilter,
  setCustomDateFrom,
  setCustomDateTo,
}: OltEscalationsTabProps) {
  return (
    <div className="space-y-4">
      <DateChipFilter
        dateFilter={dateFilter}
        customDateFrom={customDateFrom}
        customDateTo={customDateTo}
        onDateFilterChange={setDateFilter}
        onCustomDateFromChange={setCustomDateFrom}
        onCustomDateToChange={setCustomDateTo}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-red-400">{stats.escalated}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Total Escalated</div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{total}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">In Current Filter</div>
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <OltRecordTable
          records={records}
          mode="escalations"
          page={page}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          isLoading={isLoading}
          isStatusMismatch={isStatusMismatch}
          getInvestigationContext={getInvestigationContext}
        />
      </div>
    </div>
  );
}
