/**
 * Inline modal for entering a reject (or reconcile) note.
 *
 * Replaces the prior `window.prompt` usage so the reject flow:
 *   - is keyboard-trappable and ARIA-labelled
 *   - survives accidental browser-dialog dismissal
 *   - shows the staff-context the note will be attached to
 *
 * Pattern matches the inline reject drawer used in attendance-corrections.
 */

import React from 'react';
import { CheckCircle2, XCircle, Banknote, X } from 'lucide-react';
import type { ReviewAction, ReviewListItem } from './types';

const COPY: Record<ReviewAction, {
  title: string;
  intro: string;
  placeholder: string;
  confirm: string;
  icon: React.ReactNode;
  confirmCls: string;
  noteRequired: boolean;
  minChars: number;
}> = {
  approve: {
    title: 'Approve receipt',
    intro: 'Optional note — visible to the staff member on the receipt detail page.',
    placeholder: 'Optional note',
    confirm: 'Approve',
    icon: <CheckCircle2 className="w-4 h-4" />,
    confirmCls: 'bg-emerald-700 hover:bg-emerald-600 text-white',
    noteRequired: false,
    minChars: 0,
  },
  reject: {
    title: 'Reject receipt',
    intro: 'A reason is required and shown to the staff member. Be specific.',
    placeholder: 'Reason for rejection (>=5 chars)',
    confirm: 'Reject',
    icon: <XCircle className="w-4 h-4" />,
    confirmCls: 'bg-red-700 hover:bg-red-600 text-white',
    noteRequired: true,
    minChars: 5,
  },
  reconcile: {
    title: 'Reconcile receipt',
    intro: 'Optional reconciliation note — for the audit trail (e.g. bank-statement line ID).',
    placeholder: 'Optional reconciliation note',
    confirm: 'Reconcile',
    icon: <Banknote className="w-4 h-4" />,
    confirmCls: 'bg-blue-700 hover:bg-blue-600 text-white',
    noteRequired: false,
    minChars: 0,
  },
};

interface Props {
  item: ReviewListItem;
  action: ReviewAction;
  pending: boolean;
  onConfirm: (note: string | null) => void;
  onCancel: () => void;
}

export function RejectDrawer({ item, action, pending, onConfirm, onCancel }: Props) {
  const cfg = COPY[action];
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  const handleConfirm = () => {
    const trimmed = note.trim();
    if (cfg.noteRequired && trimmed.length < cfg.minChars) {
      setError(`Reason must be at least ${cfg.minChars} characters.`);
      return;
    }
    if (trimmed.length > 500) {
      setError('Note must be 500 characters or fewer.');
      return;
    }
    setError(null);
    onConfirm(trimmed.length > 0 ? trimmed : null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-drawer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-neutral-800">
          <div className="flex items-start gap-2">
            {cfg.icon}
            <div>
              <h2 id="reject-drawer-title" className="text-base font-semibold text-neutral-100">
                {cfg.title}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-400">
                {item.vendor ?? 'Unknown vendor'} · {item.staff_name ?? 'Unknown staff'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-neutral-300">{cfg.intro}</p>
          <label className="block">
            <span className="sr-only">Note</span>
            <textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={cfg.placeholder}
              rows={4}
              maxLength={500}
              disabled={pending}
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 text-sm text-neutral-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </label>
          <div className="flex justify-between text-[11px] text-neutral-500">
            <span>{note.length} / 500</span>
            {cfg.noteRequired && <span>Reason is required</span>}
          </div>
          {error && (
            <div role="alert" className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded-md px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 pb-5 pt-2 border-t border-neutral-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${cfg.confirmCls}`}
          >
            {pending ? 'Working…' : cfg.confirm}
          </button>
        </footer>
      </div>
    </div>
  );
}
