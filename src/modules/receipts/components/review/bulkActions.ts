import type { ReceiptStatus } from '@/modules/receipts/queries';
import type { ReviewAction, ReviewListItem } from './types';

/**
 * Which actions a row's current status permits, and the button label for
 * each — the actual single source of truth: RowActions renders from this
 * map instead of its own per-status JSX branches, and BulkActionBar reads
 * the same labels via commonBulkStatus() below. Keeping one map means
 * "reconciled -> approve" can't drift into "Approve" in one place and
 * "Undo reconcile" in another.
 */
export const ACTIONS_BY_STATUS: Record<ReceiptStatus, ReviewAction[]> = {
  submitted: ['approve', 'reject'],
  approved: ['reconcile', 'reject'],
  rejected: ['approve'],
  reconciled: ['approve'],
};

export const ACTION_LABEL_OVERRIDES: Partial<Record<ReceiptStatus, Partial<Record<ReviewAction, string>>>> = {
  reconciled: { approve: 'Undo reconcile' },
};

export function actionLabel(status: ReceiptStatus, action: ReviewAction, defaultLabel: string): string {
  return ACTION_LABEL_OVERRIDES[status]?.[action] ?? defaultLabel;
}

/**
 * The single status shared by every item in the selection, or null if the
 * selection is empty or mixed. Used by both commonBulkActions (which
 * actions apply) and the bulk-action bar's labels (actionLabel above).
 */
export function commonBulkStatus(items: ReviewListItem[]): ReceiptStatus | null {
  if (items.length === 0) return null;
  const statuses = new Set(items.map((i) => i.status));
  return statuses.size === 1 ? ([...statuses][0] as ReceiptStatus) : null;
}

/**
 * Actions valid for a whole selection at once. A bulk action only makes
 * sense when every selected receipt shares one status — mixed-status
 * selections return no actions, forcing the reviewer to narrow the
 * selection rather than silently skipping ineligible rows.
 */
export function commonBulkActions(items: ReviewListItem[]): ReviewAction[] {
  const status = commonBulkStatus(items);
  return status ? ACTIONS_BY_STATUS[status] : [];
}
