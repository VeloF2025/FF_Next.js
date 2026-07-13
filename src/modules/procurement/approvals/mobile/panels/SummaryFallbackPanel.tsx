import Link from 'next/link';
import type { ApprovalRequestRecord } from '../types';

const FULL_RECORD_PATH: Partial<Record<string, (id: string) => string>> = {
  purchase_order: (id) => `/procurement/purchase-orders/${id}`,
  purchase_requisition: (id) => `/procurement/requisitions/${id}`,
};

export function SummaryFallbackPanel({ record }: { record: ApprovalRequestRecord }) {
  const href = FULL_RECORD_PATH[record.documentType]?.(record.documentId);
  return (
    <section data-testid="summary-fallback-panel" className="p-4 space-y-3">
      <p className="text-sm text-[var(--ff-text-secondary)]">
        Review the full record before deciding — a mobile detail view for this approval type is coming.
      </p>
      {href && (
        <Link href={href} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]">
          Open full record
        </Link>
      )}
    </section>
  );
}
