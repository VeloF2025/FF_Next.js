'use client';

import { StandardDataTable } from '@/components/ui/StandardDataTable';
import type { TableColumn } from '@/components/ui/StandardDataTable';
import { Badge } from '@/components/ui/Badge';
import type { StuckDelta } from '../types';

interface StuckDeltaTableProps {
  rows: StuckDelta[];
  isLoading?: boolean;
}

export function StuckDeltaTable({ rows, isLoading }: StuckDeltaTableProps) {
  const columns: TableColumn<StuckDelta>[] = [
    { key: 'label', header: 'Feature', render: r => <span className="font-mono text-xs">{r.label ?? r.featureKey}</span> },
    { key: 'kind', header: 'Kind', render: r => <span className="capitalize">{r.kind}</span> },
    { key: 'status', header: 'Status' },
    {
      key: 'lastStatus', header: 'Last status',
      render: r => <span className="text-xs uppercase text-[var(--ff-text-secondary)]">{r.lastStatus}</span>,
    },
    { key: 'createdAt', header: 'Created (UTC)', render: r => r.createdAt.replace('T', ' ').replace('Z', '') },
    {
      key: 'verdict',
      header: 'Verdict',
      render: r => r.supersededByAppliedTwin
        ? <Badge variant="custom" colorClass="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">Stale duplicate (recovered)</Badge>
        : <Badge variant="custom" colorClass="bg-amber-500/20 text-amber-600">Genuinely stuck</Badge>,
    },
  ];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Stuck deltas ({rows.length})</h3>
      <StandardDataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        emptyMessage="No stuck deltas — nothing genuinely stuck or superseded"
        getRowKey={r => r.deltaId}
        stickyHeader
      />
    </section>
  );
}
