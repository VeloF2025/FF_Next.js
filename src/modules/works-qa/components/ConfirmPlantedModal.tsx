import { useState } from 'react';
import { useVerificationSnag } from '../hooks/useVerificationSnag';
import { log } from '@/lib/logger';
import type { CreateSnagRequest } from '@/modules/construction-qa/types/snag.types';

interface ConfirmPlantedModalProps {
  open: boolean;
  projectId: string;
  poleQaPhotoId: string;
  poleLabel: string;
  onClose: () => void;
  onChanged: () => void;
}

interface ConfirmationState {
  planted: boolean;
  ticketUid: string | null;          // present only when a NOC ticket was created or already linked
  assignedToName: string | null;     // best-effort name of the assignee (e.g. site manager)
  ticketError: string | null;        // non-fatal: snag saved but ticket creation failed
}

export function ConfirmPlantedModal({ open, projectId, poleQaPhotoId, poleLabel, onClose, onChanged }: ConfirmPlantedModalProps) {
  const { snag, isLoading, mutate } = useVerificationSnag(open ? projectId : null, open ? poleQaPhotoId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);

  if (!open) return null;

  function handleClose() {
    setConfirmation(null);
    setError(null);
    onClose();
  }

  async function answer(planted: boolean) {
    setBusy(true);
    setError(null);
    const stamp = new Date().toISOString();
    const note = `${planted ? 'Confirmed PLANTED' : 'Confirmed NOT PLANTED'} at ${stamp}`;

    try {
      // ── 1. Create or reuse the verification snag ──────────────────────────
      let snagId = snag?.id;
      const existingTicketUid = snag?.noc_ticket_uid ?? null;
      if (!snagId) {
        const createBody: CreateSnagRequest = {
          project_id: projectId,
          category: 'verification',
          severity: 'minor',
          description: 'Confirm if pole is planted on site',
          pole_references: [poleLabel],
          pole_qa_photo_id: poleQaPhotoId,
          verification_notes: note,
        };
        const createRes = await fetch('/api/snags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });
        if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
        const created = await createRes.json() as { data?: { id: string } };
        snagId = created.data?.id;
        if (!snagId) throw new Error('Snag POST did not return an id');
      }

      // ── 2. Status / notes update ──────────────────────────────────────────
      if (planted) {
        const patchRes = await fetch('/api/snags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snagId, status: 'verified', verification_notes: note }),
        });
        if (!patchRes.ok) throw new Error(`Verify failed: ${patchRes.status}`);
      } else if (snag) {
        // Existing open snag — append a fresh "still not planted" note line.
        const merged = (snag.verification_notes ? snag.verification_notes + '\n' : '') + note;
        const patchRes = await fetch('/api/snags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snagId, verification_notes: merged }),
        });
        if (!patchRes.ok) throw new Error(`Note update failed: ${patchRes.status}`);
      }
      // (New "No — not planted" snag: verification_notes is already set on POST.)

      // ── 3. NOC ticket — only on "No — not planted" ────────────────────────
      let ticketUid: string | null = existingTicketUid;
      let assignedToName: string | null = null;
      let ticketError: string | null = null;

      if (!planted && !existingTicketUid) {
        const ticketRes = await fetch('/api/snags/create-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snag_id: snagId }),
        });
        if (ticketRes.ok) {
          const ticketBody = await ticketRes.json() as {
            data?: { ticket?: { ticket_uid?: string; assigned_to_name?: string | null } };
          };
          ticketUid = ticketBody.data?.ticket?.ticket_uid ?? null;
          assignedToName = ticketBody.data?.ticket?.assigned_to_name ?? null;
        } else {
          // Snag is saved; surface the ticket failure to the user but don't roll back.
          ticketError = `NOC ticket could not be created (HTTP ${ticketRes.status}). The snag is saved — please escalate manually from the snags page.`;
          log.warn('works-qa: NOC ticket creation failed after verification snag created', {
            snagId, status: ticketRes.status, poleLabel,
          });
        }
      }

      await mutate();
      onChanged();
      setConfirmation({ planted, ticketUid, assignedToName, ticketError });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('works-qa: confirm planted failed', { error: msg, poleLabel });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  // ── Confirmation panel (shown after a Yes/No action completes) ─────────────
  if (confirmation) {
    const { planted, ticketUid, assignedToName, ticketError } = confirmation;
    return (
      <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center px-4" onClick={handleClose}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md p-5 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            {planted ? (
              <span className="text-green-400 text-xl leading-none">✓</span>
            ) : (
              <span className="text-amber-400 text-xl leading-none">⚠</span>
            )}
            <h2 className="text-zinc-100 font-semibold">
              {planted ? 'Pole confirmed as planted' : 'Pole flagged as NOT planted'}
            </h2>
          </div>

          <p className="text-sm text-zinc-300">
            Pole <span className="font-mono text-zinc-100">{poleLabel}</span> {planted
              ? 'is now marked as verified. The snag has been resolved.'
              : 'has been raised as a verification snag.'}
          </p>

          {!planted && ticketUid && (
            <div className="border border-zinc-800 rounded p-3 flex flex-col gap-1 bg-zinc-800/30">
              <div className="text-xs text-zinc-500 uppercase tracking-wide">NOC ticket</div>
              <div className="text-sm font-mono text-teal-300">{ticketUid}</div>
              {assignedToName && (
                <div className="text-xs text-zinc-400">Assigned to {assignedToName}</div>
              )}
            </div>
          )}

          {!planted && ticketError && (
            <p className="text-xs text-amber-400">{ticketError}</p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Question panel (default) ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center px-4" onClick={handleClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-zinc-100 font-semibold">Confirm: Is pole {poleLabel} planted on site?</h2>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Checking existing snag…</p>
        ) : snag ? (
          <div className="text-xs text-zinc-400 border border-zinc-800 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
            <div className="text-zinc-500 mb-1">
              Existing snag ({snag.status})
              {snag.noc_ticket_uid && <span className="text-teal-400"> · ticket {snag.noc_ticket_uid}</span>}:
            </div>
            {snag.verification_notes ?? snag.description}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No existing verification snag for this pole.</p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy || isLoading}
            className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void answer(false)}
            disabled={busy || isLoading}
            className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-40"
          >
            {busy ? 'Working…' : 'No — not planted'}
          </button>
          <button
            type="button"
            onClick={() => void answer(true)}
            disabled={busy || isLoading}
            className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Yes — planted'}
          </button>
        </div>
      </div>
    </div>
  );
}
