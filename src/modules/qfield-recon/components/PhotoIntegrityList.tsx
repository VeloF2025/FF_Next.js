'use client';

import { CheckCircle2 } from 'lucide-react';
import { StandardDataTable } from '@/components/ui/StandardDataTable';
import type { TableColumn } from '@/components/ui/StandardDataTable';
import { Badge } from '@/components/ui/Badge';
import type { PhotoFlag } from '../types';

interface PhotoIntegrityListProps {
  flags: PhotoFlag[];
  isLoading?: boolean;
}

export function PhotoIntegrityList({ flags, isLoading }: PhotoIntegrityListProps) {
  if (!isLoading && flags.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Photo integrity</h3>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-sm text-green-500">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          All referenced photos are present in storage
        </div>
      </section>
    );
  }

  const columns: TableColumn<PhotoFlag>[] = [
    { key: 'label', header: 'Feature', render: f => <span className="font-mono text-xs">{f.label ?? f.featureKey}</span> },
    {
      key: 'photoKey', header: 'Photo key',
      render: f => <span className="font-mono text-xs text-[var(--ff-text-secondary)]">{f.photoKey}</span>,
    },
    { key: 'status', header: 'Status', render: () => <Badge colorClass="bg-red-500/20 text-red-600">Missing</Badge> },
  ];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Photo integrity ({flags.length} missing)</h3>
      <StandardDataTable
        columns={columns}
        data={flags}
        isLoading={isLoading}
        emptyMessage="No missing photos"
        getRowKey={f => `${f.deltaId}-${f.photoKey}`}
        stickyHeader
      />
    </section>
  );
}
