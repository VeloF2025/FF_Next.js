/**
 * OltEscalationsTab — read-only view of escalated records
 */

'use client';

import type { OltRecord, InvestigationContext } from '../../../types';
import { OltRecordTable } from './OltRecordTable';

interface OltEscalationsTabProps {
  records: OltRecord[];
  isLoading: boolean;
  page: number;
  total: number;
  pageSize: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  isStatusMismatch: (record: OltRecord) => boolean;
  getInvestigationContext: (record: OltRecord) => InvestigationContext | null;
}

export function OltEscalationsTab({
  records,
  isLoading,
  page,
  total,
  pageSize,
  setPage,
  isStatusMismatch,
  getInvestigationContext,
}: OltEscalationsTabProps) {
  return (
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
  );
}
