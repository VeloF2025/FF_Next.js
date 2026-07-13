import { useState } from 'react';

export function ReasonBottomSheet({ title, confirmLabel, onConfirm, onCancel, busy }: {
  title: string; confirmLabel: string; onConfirm: (reason: string) => void; onCancel: () => void; busy: boolean;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onCancel}>
      <div className="w-full rounded-t-2xl bg-[var(--ff-bg-secondary)] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-[var(--ff-text-primary)]">{title}</h3>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          placeholder="Reason (required)"
          className="w-full px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]" />
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-3 rounded-lg border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]">Cancel</button>
          <button onClick={() => onConfirm(reason.trim())} disabled={!valid || busy}
            className="flex-1 py-3 rounded-lg bg-red-600 text-white disabled:opacity-50">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
