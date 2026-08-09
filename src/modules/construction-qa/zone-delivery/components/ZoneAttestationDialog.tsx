import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { effectiveAtFor, sastToday } from '../services/zoneAttestationDate';

export interface AttestationValues {
  effectiveAt: string;
  reason?: string;
}

interface Props {
  open: boolean;
  title: string;
  description: string;
  dateLabel: string;
  confirmLabel: string;
  submitting: boolean;
  error: string | null;
  /** Force the reason field even on today's date (e.g. replacing evidence). */
  requireReason?: boolean;
  reasonHint?: string;
  children?: ReactNode;
  onClose: () => void;
  onSubmit: (values: AttestationValues) => Promise<boolean>;
}

export function ZoneAttestationDialog({
  open, title, description, dateLabel, confirmLabel,
  submitting, error, requireReason = false, reasonHint, children, onClose, onSubmit,
}: Props) {
  const today = sastToday();
  const [day, setDay] = useState(today);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setDay(sastToday());
      setReason('');
    }
  }, [open]);

  const close = useCallback(() => onClose(), [onClose]);
  const { dialogRef, handleKeyDown } = useDialogFocus(open, close);

  // The command requires a reason for anything back-dated. Asking for one only
  // when it is actually needed keeps the ordinary case to a date and a click,
  // which is the whole point of the button.
  // The command also demands a reason when it is correcting something that
  // already exists — replacing an active document, or re-recording a date. The
  // caller knows that before the date is chosen, so it can ask for one up
  // front rather than letting the command reject a submission the operator
  // has no way to fix from this dialog.
  const backdated = day < today;
  const needsReason = backdated || requireReason;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const succeeded = await onSubmit({
      effectiveAt: effectiveAtFor(day, today),
      ...(needsReason && reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (succeeded) close();
  };

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="zone-attestation-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <form
        onSubmit={event => void submit(event)}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--ff-bg-primary)] p-5"
      >
        <div>
          <h2 id="zone-attestation-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">{description}</p>
        </div>

        {children}

        <label className="block text-sm text-[var(--ff-text-primary)]">
          {dateLabel}
          <input
            type="date"
            required
            value={day}
            max={today}
            onChange={event => setDay(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2"
          />
        </label>

        {needsReason && (
          <label className="block text-sm text-[var(--ff-text-primary)]">
            {backdated ? 'Reason for the earlier date' : (reasonHint ?? 'Reason')}
            <textarea
              required
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="e.g. signed on site, uploaded today"
              className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded border border-[var(--border-color)] px-3 py-2 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60">
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
