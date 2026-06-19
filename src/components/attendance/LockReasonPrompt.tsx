/**
 * Inline reason prompt for the weekly-locks page (#2005).
 *
 * Replaces window.prompt (blocking, untestable) for capturing the audit reason
 * on unlock and re-lock. Stateless — the page owns the reason string and the
 * pending action; this just renders the input and raises callbacks.
 */

interface Props {
  action: 'lock' | 'unlock';
  week: string;
  reason: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LockReasonPrompt({
  action,
  week,
  reason,
  busy,
  onReasonChange,
  onConfirm,
  onCancel,
}: Props) {
  const isUnlock = action === 'unlock';
  return (
    <div className="rounded border border-neutral-700 bg-neutral-900 p-3 space-y-2 max-w-xl">
      <div className="text-sm font-medium">
        {isUnlock ? 'Unlock' : 'Re-lock'} week {week}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          autoFocus
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={
            isUnlock ? 'Reason (≥ 10 chars, audit trail)' : 'Re-lock reason (audit trail)'
          }
          className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm flex-1"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="px-3 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-sm"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
