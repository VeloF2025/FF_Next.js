import { CheckCircle2, XCircle, Banknote, X, Loader2 } from 'lucide-react';
import type { ReviewAction } from './types';
import { commonBulkActions, commonBulkStatus, actionLabel } from './bulkActions';
import type { ReviewListItem } from './types';

const ACTION_CFG: Record<ReviewAction, { icon: React.ReactNode; defaultLabel: string; cls: string }> = {
  approve: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    defaultLabel: 'Approve',
    cls: 'bg-emerald-700 hover:bg-emerald-600 text-white',
  },
  reject: {
    icon: <XCircle className="w-4 h-4" />,
    defaultLabel: 'Reject',
    cls: 'bg-red-700 hover:bg-red-600 text-white',
  },
  reconcile: {
    icon: <Banknote className="w-4 h-4" />,
    defaultLabel: 'Reconcile',
    cls: 'bg-blue-700 hover:bg-blue-600 text-white',
  },
};

/**
 * Sticky toolbar shown when 1+ rows are selected. Only offers actions
 * valid for the whole selection (see commonBulkActions) — a mixed-status
 * selection shows a hint instead of buttons, rather than silently
 * skipping ineligible rows.
 */
export function BulkActionBar({
  selected,
  pending,
  onAction,
  onClear,
}: {
  selected: ReviewListItem[];
  pending: boolean;
  onAction: (action: ReviewAction) => void;
  onClear: () => void;
}) {
  if (selected.length === 0) return null;
  const actions = commonBulkActions(selected);
  const status = commonBulkStatus(selected);

  return (
    <div
      className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 shadow-md"
      style={{
        background: 'var(--ff-primary-50)',
        borderColor: 'var(--ff-primary-200)',
      }}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-sm font-semibold" style={{ color: 'var(--ff-primary-700)' }}>
        {selected.length} selected
      </span>

      {actions.length > 0 ? (
        actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={pending}
            onClick={() => onAction(action)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${ACTION_CFG[action].cls}`}
          >
            {ACTION_CFG[action].icon}
            {status ? actionLabel(status, action, ACTION_CFG[action].defaultLabel) : ACTION_CFG[action].defaultLabel}
          </button>
        ))
      ) : (
        <span className="text-xs" style={{ color: 'var(--ff-primary-700)' }}>
          Select receipts with the same status to bulk-act.
        </span>
      )}

      {pending && <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--ff-primary-700)' }} />}

      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs ml-auto disabled:opacity-50"
        style={{ color: 'var(--ff-primary-700)' }}
      >
        <X className="w-3.5 h-3.5" />
        Clear
      </button>
    </div>
  );
}
