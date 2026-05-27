import { useState } from 'react';
import type { AssignableUser } from '../hooks/useAssignableUsers';

export type SnagSeverity = 'minor' | 'major' | 'critical';

export interface SnagSubmitInput {
  comment: string;
  severity: SnagSeverity;
  assignedToUserId: string | null;
  amend?: boolean;
}

export interface SnagSubmitResult {
  status: 'created' | 'amended' | 'duplicate' | 'error';
  existingSnagId?: string;
  errorMessage?: string;
}

interface Props {
  assignableUsers: AssignableUser[];
  loadingUsers?: boolean;
  onSubmit: (input: SnagSubmitInput) => Promise<SnagSubmitResult>;
  onCancel: () => void;
}

export function SnagInlineForm({ assignableUsers, loadingUsers, onSubmit, onCancel }: Props) {
  const [comment, setComment] = useState('');
  const [severity, setSeverity] = useState<SnagSeverity>('major');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  // When a duplicate snag exists, we surface an "Add to existing" prompt
  // instead of just blocking — Hein's UX rule.
  const [duplicate, setDuplicate] = useState<{ existingSnagId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(amend: boolean) {
    if (!comment.trim()) {
      setError('Comment is required');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit({
        comment: comment.trim(),
        severity,
        assignedToUserId: assigneeId || null,
        amend,
      });
      if (result.status === 'duplicate') {
        setDuplicate({ existingSnagId: result.existingSnagId ?? 'unknown' });
        return;
      }
      if (result.status === 'error') {
        setError(result.errorMessage ?? 'Snag failed');
        return;
      }
      // status 'created' or 'amended' — parent has refetched; close.
      onCancel();
    } finally {
      setSubmitting(false);
    }
  }

  if (duplicate) {
    return (
      <div className="flex flex-col gap-2 mt-1 p-2 rounded border border-amber-500/40 bg-amber-500/5">
        <p className="text-xs text-amber-300">
          An open snag already exists on this slot (#{duplicate.existingSnagId.slice(0, 8)}). Add the new comment to the existing snag/ticket?
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={submitting}
            onClick={() => { void submit(true); }}
            className="text-xs bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1 disabled:opacity-50"
          >
            {submitting ? 'Amending…' : 'Add to existing'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1 p-2 rounded border border-red-500/40 bg-red-500/5">
      <textarea
        rows={2}
        placeholder="What's wrong? (required)"
        value={comment}
        onChange={e => setComment(e.target.value)}
        maxLength={2000}
        className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500 resize-none"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={severity}
          onChange={e => setSeverity(e.target.value as SnagSeverity)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
        >
          <option value="minor">Minor</option>
          <option value="major">Major</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={assigneeId}
          onChange={e => setAssigneeId(e.target.value)}
          disabled={loadingUsers}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 disabled:opacity-50"
        >
          <option value="">Auto-assign (site mgr)</option>
          {assignableUsers.map(u => (
            <option key={u.user_id} value={u.user_id}>{u.name} ({u.role})</option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-1">
        <button
          type="button"
          disabled={submitting}
          onClick={() => { void submit(false); }}
          className="text-xs bg-red-600 hover:bg-red-500 text-white rounded px-2 py-1 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Submit snag'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
