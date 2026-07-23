/**
 * CAPA detail header - title, back link, status/severity badges
 */

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { CAPAStatusBadge, CAPASeverityBadge } from './CAPAStatusBadge';
import type { CAPA } from '@/modules/health-safety/types/capa.types';

export function CAPADetailHeader({ capa }: { capa: CAPA & { is_overdue?: boolean } }) {
  return (
    <div className="space-y-4">
      <Link
        href="/projects/health-safety/capa"
        className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Corrective Actions
      </Link>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-3">{capa.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <CAPAStatusBadge status={capa.is_overdue && capa.status !== 'closed' ? 'overdue' : capa.status} />
          <CAPASeverityBadge severity={capa.severity} />
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] capitalize">
            {capa.source_type}
          </span>
        </div>
      </div>
    </div>
  );
}
