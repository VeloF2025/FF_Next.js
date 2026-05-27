import {
  Receipt,
  CheckCircle2,
  XCircle,
  Banknote,
  Eye,
  Loader2,
} from 'lucide-react';
import {
  RECEIPT_CATEGORY_LABELS,
} from '@/modules/receipts/categories';

import { StatusPill } from './StatusPill';
import { formatRand, formatDate, formatRelative } from './format';
import type { ReviewAction, ReviewListItem } from './types';

export function ReceiptsTable({
  items,
  loading,
  pendingId,
  onAction,
}: {
  items: ReviewListItem[] | null;
  loading: boolean;
  pendingId: string | null;
  onAction: (item: ReviewListItem, action: ReviewAction) => void;
}) {
  if (loading && items === null) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 rounded-lg bg-neutral-800/40 animate-pulse" />
        ))}
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        <Receipt className="w-8 h-8 mx-auto text-neutral-600" />
        <div className="mt-2 text-sm text-neutral-300">No receipts match these filters.</div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-950/40 text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Staff</th>
              <th className="px-4 py-2">Vendor</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Project / Vehicle</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {items.map((r) => (
              <Row key={r.id} item={r} pendingId={pendingId} onAction={onAction} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  item,
  pendingId,
  onAction,
}: {
  item: ReviewListItem;
  pendingId: string | null;
  onAction: (item: ReviewListItem, action: ReviewAction) => void;
}) {
  const isPending = pendingId === item.id;
  const totalCents = Number(item.total_cents);

  return (
    <tr className="text-neutral-200 align-top">
      <td className="px-4 py-3 whitespace-nowrap">
        {formatDate(item.receipt_date)}
        <div className="text-xs text-neutral-500 mt-0.5">
          captured {formatRelative(item.captured_at)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{item.staff_name ?? '—'}</div>
        {item.staff_email && (
          <div className="text-xs text-neutral-500">{item.staff_email}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium truncate max-w-xs" title={item.vendor ?? ''}>
          {item.vendor ?? <span className="text-neutral-500">No vendor</span>}
        </div>
        {item.description && (
          <div className="text-xs text-neutral-500 truncate max-w-xs" title={item.description}>
            {item.description}
          </div>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-xs uppercase tracking-wide text-neutral-300">
          {RECEIPT_CATEGORY_LABELS[item.category] ?? item.category}
        </span>
        {item.payment_method === 'company_card' && (
          <div className="text-[10px] text-neutral-500 mt-0.5">Company card</div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-neutral-400">
        {item.project_name ? (
          <div className="text-neutral-200">{item.project_name}</div>
        ) : (
          <div className="text-neutral-600">—</div>
        )}
        {item.vehicle_registration && (
          <div className="mt-0.5">{item.vehicle_registration}</div>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold">
        {formatRand(totalCents)}
        {item.vat_cents !== null && (
          <div className="text-xs text-neutral-500 font-normal">
            VAT {formatRand(Number(item.vat_cents))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <StatusPill status={item.status} />
        {item.reviewed_by_name && (
          <div className="text-[10px] text-neutral-500 mt-1">
            by {item.reviewed_by_name}
          </div>
        )}
        {item.review_note && (
          <div className="text-[10px] text-neutral-400 mt-0.5 max-w-[12rem] truncate" title={item.review_note}>
            “{item.review_note}”
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <RowActions item={item} pendingId={pendingId} isPending={isPending} onAction={onAction} />
      </td>
    </tr>
  );
}

function RowActions({
  item,
  isPending,
  onAction,
}: {
  item: ReviewListItem;
  pendingId: string | null;
  isPending: boolean;
  onAction: (item: ReviewListItem, action: ReviewAction) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <a
        href={`/api/staff/receipts-image?id=${encodeURIComponent(item.id)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 px-2 py-1.5 text-xs text-neutral-200"
        title="Open the captured image"
      >
        <Eye className="w-3.5 h-3.5" />
        Image
      </a>
      {item.status === 'submitted' && (
        <>
          <ActionButton kind="approve" disabled={isPending} onClick={() => onAction(item, 'approve')} />
          <ActionButton kind="reject" disabled={isPending} onClick={() => onAction(item, 'reject')} />
        </>
      )}
      {item.status === 'approved' && (
        <>
          <ActionButton kind="reconcile" disabled={isPending} onClick={() => onAction(item, 'reconcile')} />
          <ActionButton kind="reject" disabled={isPending} onClick={() => onAction(item, 'reject')} />
        </>
      )}
      {item.status === 'rejected' && (
        <ActionButton kind="approve" disabled={isPending} onClick={() => onAction(item, 'approve')} />
      )}
      {item.status === 'reconciled' && (
        <ActionButton
          kind="approve"
          disabled={isPending}
          onClick={() => onAction(item, 'approve')}
          label="Undo reconcile"
        />
      )}
      {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />}
    </div>
  );
}

function ActionButton({
  kind,
  disabled,
  onClick,
  label,
}: {
  kind: ReviewAction;
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  const cfg = {
    approve: {
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      text: label ?? 'Approve',
      cls: 'bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-600',
    },
    reject: {
      icon: <XCircle className="w-3.5 h-3.5" />,
      text: label ?? 'Reject',
      cls: 'bg-red-800 hover:bg-red-700 text-white border-red-700',
    },
    reconcile: {
      icon: <Banknote className="w-3.5 h-3.5" />,
      text: label ?? 'Reconcile',
      cls: 'bg-blue-700 hover:bg-blue-600 text-white border-blue-600',
    },
  }[kind];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.text}
    </button>
  );
}
