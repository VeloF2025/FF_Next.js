import { CheckCircle2, XCircle, Banknote, Eye, Loader2 } from 'lucide-react';
import { ACTIONS_BY_STATUS, actionLabel } from './bulkActions';
import type { ReviewAction, ReviewListItem } from './types';

/**
 * Per-row action buttons — shared between the desktop table and the
 * mobile card list, and driven by the same ACTIONS_BY_STATUS map the
 * bulk-action bar uses, so which actions/labels a status offers can't
 * drift between the two surfaces.
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
      {ACTIONS_BY_STATUS[item.status].map((action) => (
        <ActionButton
          key={action}
          kind={action}
          disabled={isPending}
          onClick={() => onAction(item, action)}
          label={actionLabel(item.status, action, DEFAULT_LABEL[action])}
        />
      ))}
      {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--ff-text-tertiary)' }} />}
    </div>
  );
}

const DEFAULT_LABEL: Record<ReviewAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  reconcile: 'Reconcile',
};

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
