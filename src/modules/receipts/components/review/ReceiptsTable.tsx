import { Receipt } from 'lucide-react';
import { RECEIPT_CATEGORY_LABELS } from '@/modules/receipts/categories';

import { StatusPill } from './StatusPill';
import { RowActions } from './RowActions';
import { ReceiptCard } from './ReceiptCard';
import { formatRand, formatDate, formatRelative } from './format';
import type { ReviewAction, ReviewListItem } from './types';

export function ReceiptsTable({
  items,
  loading,
  pendingId,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onAction,
}: {
  items: ReviewListItem[] | null;
  loading: boolean;
  pendingId: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onAction: (item: ReviewListItem, action: ReviewAction) => void;
}) {
  if (loading && items === null) {
    return (
      <div className="ff-card space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-10 rounded-lg animate-pulse"
            style={{ background: 'var(--ff-bg-tertiary)' }}
          />
        ))}
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="ff-card p-8 text-center">
        <Receipt className="w-8 h-8 mx-auto" style={{ color: 'var(--ff-text-tertiary)' }} />
        <div className="mt-2 text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
          No receipts match these filters.
        </div>
      </div>
    );
  }

  const allSelected = items.every((i) => selectedIds.has(i.id));

  return (
    <>
      {/* Mobile: stacked cards, no horizontal scroll */}
      <div className="sm:hidden space-y-3">
        {items.map((r) => (
          <ReceiptCard
            key={r.id}
            item={r}
            selected={selectedIds.has(r.id)}
            pendingId={pendingId}
            onToggleSelect={onToggleSelect}
            onAction={onAction}
          />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block ff-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead
              className="text-left text-xs uppercase tracking-wide"
              style={{ background: 'var(--ff-bg-tertiary)', color: 'var(--ff-text-secondary)' }}
            >
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleSelectAll}
                    aria-label="Select all visible receipts"
                    className="w-4 h-4"
                  />
                </th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Project / Vehicle</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--ff-border-light)' }}>
              {items.map((r) => (
                <Row
                  key={r.id}
                  item={r}
                  selected={selectedIds.has(r.id)}
                  pendingId={pendingId}
                  onToggleSelect={onToggleSelect}
                  onAction={onAction}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Row({
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
    <tr style={{ color: 'var(--ff-text-primary)' }} className="align-top">
      <td className="px-4 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select receipt from ${item.vendor ?? 'unknown vendor'}`}
          className="w-4 h-4"
        />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {formatDate(item.receipt_date)}
        <div className="text-xs mt-0.5" style={{ color: 'var(--ff-text-tertiary)' }}>
          captured {formatRelative(item.captured_at)}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium">{item.staff_name ?? '—'}</div>
        {item.staff_email && (
          <div className="text-xs" style={{ color: 'var(--ff-text-tertiary)' }}>
            {item.staff_email}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium truncate max-w-xs" title={item.vendor ?? ''}>
          {item.vendor ?? <span style={{ color: 'var(--ff-text-tertiary)' }}>No vendor</span>}
        </div>
        {item.description && (
          <div
            className="text-xs truncate max-w-xs"
            title={item.description}
            style={{ color: 'var(--ff-text-tertiary)' }}
          >
            {item.description}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--ff-text-secondary)' }}>
          {RECEIPT_CATEGORY_LABELS[item.category] ?? item.category}
        </span>
        {item.payment_method === 'company_card' && (
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--ff-text-tertiary)' }}>
            Company card
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
        {item.project_name ? (
          <div style={{ color: 'var(--ff-text-primary)' }}>{item.project_name}</div>
        ) : (
          <div style={{ color: 'var(--ff-text-tertiary)' }}>—</div>
        )}
        {item.vehicle_registration && <div className="mt-0.5">{item.vehicle_registration}</div>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold">
        {formatRand(totalCents)}
        {item.vat_cents !== null && (
          <div className="text-xs font-normal" style={{ color: 'var(--ff-text-tertiary)' }}>
            VAT {formatRand(Number(item.vat_cents))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <StatusPill status={item.status} />
        {item.reviewed_by_name && (
          <div className="text-[10px] mt-1" style={{ color: 'var(--ff-text-tertiary)' }}>
            by {item.reviewed_by_name}
          </div>
        )}
        {item.review_note && (
          <div
            className="text-[10px] mt-0.5 max-w-[12rem] truncate"
            title={item.review_note}
            style={{ color: 'var(--ff-text-secondary)' }}
          >
            “{item.review_note}”
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <RowActions item={item} isPending={isPending} onAction={onAction} />
      </td>
    </tr>
  );
}
