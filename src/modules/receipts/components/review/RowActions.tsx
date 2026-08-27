import { CheckCircle2, XCircle, Banknote, Eye, Loader2 } from 'lucide-react';
import type { ReviewAction, ReviewListItem } from './types';

/**
 * Per-row action buttons — shared between the desktop table and the
 * mobile card list so the transition rules only live in one place.
 */
export function RowActions({
  item,
  isPending,
  onAction,
}: {
  item: ReviewListItem;
  isPending: boolean;
  onAction: (item: ReviewListItem, action: ReviewAction) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <a
        href={`/api/staff/receipts-image?id=${encodeURIComponent(item.id)}`}
        target="_blank"
        rel="noreferrer"
        className="ff-button ff-button--secondary text-xs"
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
      {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--ff-text-tertiary)' }} />}
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
