/**
 * Inline modal for entering a reject (or reconcile) note. Used for both
 * a single receipt and a bulk selection — the caller supplies the
 * subtitle line, everything else (validation, keyboard trap) is shared.
 *
 * Replaces the prior `window.prompt` usage so the reject flow:
 *   - is keyboard-trappable and ARIA-labelled
 *   - survives accidental browser-dialog dismissal
 *   - shows the context the note will be attached to
 */

import React from 'react';
import { CheckCircle2, XCircle, Banknote, X } from 'lucide-react';
import type { ReviewAction } from './types';

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
  action: ReviewAction;
  /** e.g. "Sasol Sunnyside · Aron Kotlolo" (single) or "3 receipts selected" (bulk). */
  subtitle: string;
  pending: boolean;
  onConfirm: (note: string | null) => void;
  onCancel: () => void;
}

export function RejectDrawer({ action, subtitle, pending, onConfirm, onCancel }: Props) {
  const cfg = COPY[action];
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
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
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'var(--ff-bg-overlay)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border shadow-xl"
        style={{ background: 'var(--ff-bg-card)', borderColor: 'var(--ff-border-medium)' }}
      >
        <header
          className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b"
          style={{ borderColor: 'var(--ff-border-light)' }}
        >
          <div className="flex items-start gap-2">
            {cfg.icon}
            <div>
              <h2 id="reject-drawer-title" className="text-base font-semibold" style={{ color: 'var(--ff-text-primary)' }}>
                {cfg.title}
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ff-text-secondary)' }}>
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Close"
            className="disabled:opacity-40"
            style={{ color: 'var(--ff-text-tertiary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
            {cfg.intro}
          </p>
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
              className="ff-input resize-none text-sm focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as string]: 'var(--ff-primary-400)' }}
            />
          </label>
          <div className="flex justify-between text-[11px]" style={{ color: 'var(--ff-text-tertiary)' }}>
            <span>{note.length} / 500</span>
            {cfg.noteRequired && <span>Reason is required</span>}
          </div>
          {error && (
            <div
              role="alert"
              className="text-xs rounded-md px-2 py-1.5"
              style={{ color: 'var(--ff-error)', background: 'var(--ff-error-light)' }}
            >
              {error}
            </div>
          )}
        </div>

        <footer
          className="flex items-center justify-end gap-2 px-5 pb-5 pt-2 border-t"
          style={{ borderColor: 'var(--ff-border-light)' }}
        >
          <button type="button" onClick={onCancel} disabled={pending} className="ff-button ff-button--secondary">
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
