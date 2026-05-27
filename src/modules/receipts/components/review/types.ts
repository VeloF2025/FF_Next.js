/**
 * Shared types for the /staff/receipts review UI.
 *
 * Re-exports the canonical interfaces from queries-review so the page
 * components don't re-declare them locally and silently drift.
 */

import type {
  ReviewAction,
  ReviewListItem,
} from '@/modules/receipts/queries-review';

export type { ReviewAction, ReviewListItem };

export interface SummaryBucket {
  count: number;
  totalCents: number;
}

export interface SummaryShape {
  submitted: SummaryBucket;
  approved: SummaryBucket;
  rejected: SummaryBucket;
  reconciled: SummaryBucket;
}

export interface Filters {
  status: import('@/modules/receipts/queries').ReceiptStatus | '';
  staffId: string;
  projectId: string;
  category: import('@/modules/receipts/categories').ReceiptCategory | '';
  month: string;
}

export const DEFAULT_FILTERS: Filters = {
  status: 'submitted',
  staffId: '',
  projectId: '',
  category: '',
  month: '',
};

export function emptySummary(): SummaryShape {
  const empty: SummaryBucket = { count: 0, totalCents: 0 };
  return { submitted: empty, approved: empty, rejected: empty, reconciled: empty };
}
