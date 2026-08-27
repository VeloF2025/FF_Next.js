import type { ReceiptStatus } from '@/modules/receipts/queries';
import type { ReviewAction, ReviewListItem } from './types';

/**
 * Which actions a row's current status permits — mirrors the per-row
 * logic in ReceiptsTable's RowActions. Single source of truth for both
 * the row buttons and the bulk-action bar.
 */
export const ACTIONS_BY_STATUS: Record<ReceiptStatus, ReviewAction[]> = {
  submitted: ['approve', 'reject'],
  approved: ['reconcile', 'reject'],
  rejected: ['approve'],
  reconciled: ['approve'],
};

/**
 * Actions valid for a whole selection at once. A bulk action only makes
 * sense when every selected receipt shares one status — mixed-status
 * selections return no actions, forcing the reviewer to narrow the
 * selection rather than silently skipping ineligible rows.
 */
export function commonBulkActions(items: ReviewListItem[]): ReviewAction[] {
  if (items.length === 0) return [];
  const statuses = new Set(items.map((i) => i.status));
  if (statuses.size > 1) return [];
  const [status] = statuses;
  return ACTIONS_BY_STATUS[status as ReceiptStatus] ?? [];
}
