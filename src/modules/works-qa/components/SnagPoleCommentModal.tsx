import { useEffect, useId, useState } from 'react';
import { log } from '@/lib/logger';

interface SnagPoleCommentModalProps {
  open: boolean;
  projectId: string;
  poleQaPhotoId: string;
  poleLabel: string;
  onClose: () => void;
  onChanged: () => void;
}

type Severity = 'minor' | 'major' | 'critical';

interface ConfirmationState {
  snagId: string;
  ticketUid: string | null;
  ticketError: string | null;
}

const MIN_DESCRIPTION_LENGTH = 10;

/** Extract error message from a non-ok Response body, falling back to the status hint. */
async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: { message?: string } };
    return body?.error?.message ?? fallback;
  } catch (parseErr) {
    log.warn('works-qa.snag-pole-comment.error_body_parse_failed', { parseErr });
    return fallback;
  }
}

export function SnagPoleCommentModal({
  open,
  projectId,
  poleQaPhotoId,
  poleLabel,
  onClose,
  onChanged,
}: SnagPoleCommentModalProps) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('major');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);

  const titleId = useId();

  // Reset state on logical reopen (parent keeps the component mounted; null-return
  // on open=false hides the UI but state would otherwise persist).
  useEffect(() => {
    if (!open) {
      setDescription('');
      setSeverity('major');
      setError(null);
      setConfirmation(null);
    }
  }, [open]);

  // Escape key — no-op while a request is in-flight.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  function validate(): string | null {
    const trimmed = description.trim();
    if (trimmed.length === 0) return 'Description is required';
    if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
      return `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`;
    }
    return null;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);

    try {
      // Step 1 — create the snag
      const snagRes = await fetch('/api/snags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          pole_qa_photo_id: poleQaPhotoId,
          category: 'quality',
          severity,
          description: description.trim(),
          pole_references: [poleLabel],
        }),
      });

      if (!snagRes.ok) {
        const msg = await extractErrorMessage(snagRes, `Snag POST failed: ${snagRes.status}`);
        throw new Error(msg);
      }

      const snagBody = (await snagRes.json()) as { data: { id: string } };
      const snagId = snagBody.data.id;

      // Step 2 — create the NOC ticket (non-fatal)
      let ticketUid: string | null = null;
      let ticketError: string | null = null;

      try {
        const ticketRes = await fetch('/api/snags/create-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snag_id: snagId }),
        });

        if (!ticketRes.ok) {
          ticketError = await extractErrorMessage(ticketRes, `Ticket creation failed: ${ticketRes.status}`);
        } else {
          const ticketBody = (await ticketRes.json()) as {
            data: { ticket: { uid?: string; ticket_uid?: string } };
          };
          ticketUid =
            ticketBody.data.ticket.uid ?? ticketBody.data.ticket.ticket_uid ?? null;
        }
      } catch (ticketErr) {
        ticketError =
          ticketErr instanceof Error ? ticketErr.message : 'Ticket creation failed';
      }

      setConfirmation({ snagId, ticketUid, ticketError });
      onChanged();
    } catch (err) {
      log.error('works-qa.snag-pole-comment.submit_failed', {
        pole_label: poleLabel,
        error: err instanceof Error ? err.message : String(err),
      });
      setError(err instanceof Error ? err.message : 'Failed to raise snag');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 id={titleId} className="text-zinc-100 font-medium">⚠ Snag pole — {poleLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ×
          </button>
        </div>

        {!confirmation ? (
          <>
            <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1" htmlFor="snag-description">
              Description
            </label>
            <textarea
              id="snag-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is wrong with this pole? Be specific."
              rows={4}
              maxLength={2000}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
            />

            <label className="block text-xs uppercase tracking-wider text-zinc-400 mt-3 mb-1" htmlFor="snag-severity">
              Severity
            </label>
            <select
              id="snag-severity"
              value={severity}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'minor' || v === 'major' || v === 'critical') {
                  setSeverity(v);
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
            >
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>

            {error && (
              <p role="alert" className="text-xs text-red-400 mt-2">⚠ {error}</p>
            )}

            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1 rounded text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="px-3 py-1 rounded text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
              >
                {busy ? '…' : 'Raise snag'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-200 mb-2">✓ Snag raised for {poleLabel}.</p>
            {confirmation.ticketUid && (
              <p className="text-xs text-zinc-400">NOC ticket: <span className="text-teal-400">{confirmation.ticketUid}</span></p>
            )}
            {confirmation.ticketError && (
              <p className="text-xs text-amber-400 mt-1" role="alert">
                NOC ticket creation failed: {confirmation.ticketError} (snag saved; create ticket manually if needed)
              </p>
            )}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 rounded text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
              >
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
