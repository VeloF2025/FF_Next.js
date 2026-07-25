'use client';

import { useMemo, useState } from 'react';
import { StandardDataTable, Pagination } from '@/components/ui/StandardDataTable';
import type { TableColumn } from '@/components/ui/StandardDataTable';
import type { PonSummary } from '../types';

const PAGE_SIZE = 25;

interface PonCompletenessTableProps {
  title: string;
  rows: PonSummary[];
  isLoading?: boolean;
}

export function PonCompletenessTable({ title, rows, isLoading }: PonCompletenessTableProps) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  );

  const columns: TableColumn<PonSummary>[] = [
    { key: 'ponNo', header: 'PON', render: r => r.ponNo ?? '—' },
    {
      key: 'designFeatures', header: 'Design', className: 'text-right',
      render: r => <div className="text-right tabular-nums">{r.designFeatures || '—'}</div>,
    },
    {
      key: 'applied', header: 'Applied', className: 'text-right',
      render: r => <div className="text-right tabular-nums font-medium text-green-600">{r.applied}</div>,
    },
    {
      key: 'stuckRecoverable', header: 'Stuck', className: 'text-right',
      render: r => <div className="text-right tabular-nums text-amber-600">{r.stuckRecoverable}</div>,
    },
    {
      key: 'staleDuplicate', header: 'Stale', className: 'text-right',
      render: r => <div className="text-right tabular-nums text-[var(--ff-text-tertiary)]">{r.staleDuplicate}</div>,
    },
    {
      key: 'neverCaptured', header: 'Never captured', className: 'text-right',
      render: r => (
        <div className={`text-right tabular-nums ${r.neverCaptured > 0 ? 'font-semibold text-red-600' : 'text-[var(--ff-text-tertiary)]'}`}>
          {r.neverCaptured}
        </div>
      ),
    },
    {
      key: 'missingPhotos', header: 'Missing photos', className: 'text-right',
      render: r => <div className="text-right tabular-nums">{r.missingPhotos || '—'}</div>,
    },
  ];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">{title}</h3>
      <StandardDataTable
        columns={columns}
        data={pageRows}
        isLoading={isLoading}
        emptyMessage="No PON data for this project"
        getRowKey={r => `${r.kind}-${r.ponNo ?? 'na'}`}
        stickyHeader
      />
      {rows.length > PAGE_SIZE && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={rows.length}
          itemsPerPage={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}
    </section>
  );
}
