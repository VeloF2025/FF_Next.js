/**
 * SummaryEditor — edit the meeting executive summary in the unsealed reviewer panel
 * (Cortex Scribe Goal 3b).
 *
 * Shows the effective summary (human override if set, else AI) and lets a manager+
 * reviewer edit it — mirroring the per-action edit UX: Save disabled until changed,
 * upstream Cortex errors surfaced meaningfully (relayUpstreamError), Cancel reverts.
 * On publish, this human summary is written back to FibreFlow's meetings.summary.
 *
 * An empty Save clears the override (reverts to the AI summary). The server resolves
 * the Cortex meeting id from the path param — no client-supplied id (IDOR-safe).
 */

import { useState } from 'react';
import { Pencil, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { PermissionGate } from '@/components/PermissionGate';
import { log } from '@/lib/logger';
import { useCortexReviewMutation } from './useCortexReview';

interface SummaryEditorProps {
  meetingId: string;
  summary: string | null;
}

export function SummaryEditor({ meetingId, summary }: SummaryEditorProps) {
  const current = summary ?? '';
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(current);
  const mutation = useCortexReviewMutation(meetingId);

  function startEdit() {
    setEditText(current);
    setEditing(true);
    mutation.reset();
  }

  function cancelEdit() {
    setEditing(false);
    setEditText(current);
    mutation.reset();
  }

  // Idempotent on the server, but disable Save until the text actually changed so a
  // reviewer never fires a pointless write. Trim-compare so whitespace-only is a no-op.
  const hasChanges = editText.trim() !== current.trim();

  function save() {
    mutation.mutate(
      { op: 'editSummary', text: editText },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => log.error('Summary edit failed', { error: e.message }, 'CortexMeetingReviewPanel'),
      },
    );
  }

  const busy = mutation.isPending;

  return (
    <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--ff-text-secondary)]">Meeting Summary</p>
        {!editing && (
          <PermissionGate permission="cortex.review" action="edit">
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
              aria-label="Edit summary"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </PermissionGate>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            className="w-full bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded p-2 text-sm text-[var(--ff-text-primary)] resize-y"
            rows={5}
            placeholder="Executive summary (leave empty to revert to the AI summary)"
            aria-label="Edit meeting summary"
          />
          {mutation.isError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />{mutation.error.message}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !hasChanges}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Save
            </button>
            <button
              onClick={cancelEdit}
              disabled={busy}
              className="px-3 py-1 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        current
          ? <p className="text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap">{current}</p>
          : <p className="text-sm text-[var(--ff-text-tertiary)] italic">No summary yet.</p>
      )}
    </div>
  );
}
