import { RECEIPT_CATEGORY_LABELS } from '@/modules/receipts/categories';
import { StatusPill } from './StatusPill';
import { RowActions } from './RowActions';
import { formatRand, formatDate, formatRelative } from './format';
import type { ReviewAction, ReviewListItem } from './types';

/**
 * Stacked-card row for narrow viewports — the standard responsive
 * pattern for data tables (avoid horizontal scroll on a phone). Shown
 * instead of <ReceiptsTable>'s <table> below the sm breakpoint.
 */
export function ReceiptCard({
  item,
  selected,
  pendingId,
  onToggleSelect,
  onAction,
}: {
  item: ReviewListItem;
  selected: boolean;
  pendingId: string | null;
  onToggleSelect: (id: string) => void;
  onAction: (item: ReviewListItem, action: ReviewAction) => void;
}) {
  const isPending = pendingId === item.id;
  const totalCents = Number(item.total_cents);

  return (
    <div className="ff-card space-y-2.5">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select receipt from ${item.vendor ?? 'unknown vendor'}`}
          className="mt-1 w-4 h-4 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold truncate" style={{ color: 'var(--ff-text-primary)' }}>
                {item.vendor ?? <span style={{ color: 'var(--ff-text-tertiary)' }}>No vendor</span>}
              </div>
              <div className="text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
                {item.staff_name ?? '—'}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-semibold tabular-nums" style={{ color: 'var(--ff-text-primary)' }}>
                {formatRand(totalCents)}
              </div>
              <StatusPill status={item.status} />
            </div>
          </div>

          <div
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            style={{ color: 'var(--ff-text-secondary)' }}
          >
            <span>{formatDate(item.receipt_date)}</span>
            <span>{RECEIPT_CATEGORY_LABELS[item.category] ?? item.category}</span>
            {item.project_name && <span>{item.project_name}</span>}
            {item.vehicle_registration && <span>{item.vehicle_registration}</span>}
            <span>captured {formatRelative(item.captured_at)}</span>
          </div>

          {item.review_note && (
            <div className="mt-1 text-xs italic" style={{ color: 'var(--ff-text-secondary)' }}>
              “{item.review_note}”
            </div>
          )}

          <div className="mt-3">
            <RowActions item={item} isPending={isPending} onAction={onAction} />
          </div>
        </div>
      </div>
    </div>
  );
}
