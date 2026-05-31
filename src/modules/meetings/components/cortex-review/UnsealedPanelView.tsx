/**
 * UnsealedPanelView — the pre-seal reviewer (spec §4.1).
 *
 * Lists proposed actions with per-action Approve/Reject/Edit (manager+), and a
 * Publish button (human seal). All mutations go through useCortexReviewMutation;
 * the server resolves the Cortex meeting id from the path param (no client id).
 */

import { useState } from 'react';
import {
  CheckCircle, XCircle, Pencil, Send,
  ChevronDown, ChevronUp, Loader2, AlertCircle,
} from 'lucide-react';
import { PermissionGate } from '@/components/PermissionGate';
import { log } from '@/lib/logger';
import { useCortexReviewMutation } from './useCortexReview';
import type { ProposedAction, UnsealedPanel } from './types';
import { confidenceLabel, confidenceColor, stateColor } from './types';

interface ActionCardProps {
  action: ProposedAction;
  meetingId: string;
}

function ActionCard({ action, meetingId }: ActionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(action.text);
  const [editOwner, setEditOwner] = useState(action.owner ?? '');
  const [editDue, setEditDue] = useState(action.due ?? '');
  const mutation = useCortexReviewMutation(meetingId);

  function cancelEdit() {
    setEditing(false);
    setEditText(action.text);
    setEditOwner(action.owner ?? '');
    setEditDue(action.due ?? '');
    mutation.reset();
  }

  function run(payload: Parameters<typeof mutation.mutate>[0]) {
    mutation.mutate(payload, {
      onSuccess: () => setEditing(false),
      onError: (e) => log.error('Action mutation failed', { op: payload.op, error: e.message }, 'CortexMeetingReviewPanel'),
    });
  }

  const busy = mutation.isPending;
  // Cortex rejects a no-op edit with 422 "no field changes" — disable Save until
  // something actually changed so the user never fires a pointless failing request.
  const hasChanges =
    editText !== action.text ||
    (editOwner || '') !== (action.owner ?? '') ||
    (editDue || '') !== (action.due ?? '');

  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {editing ? (
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="w-full bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded p-2 text-sm text-[var(--ff-text-primary)] resize-none"
              rows={3}
              aria-label="Edit action text"
            />
          ) : (
            <p className="text-sm text-[var(--ff-text-primary)]">{action.text}</p>
          )}
        </div>
        <span className={`text-xs font-semibold shrink-0 ${stateColor(action.state)}`}>
          {action.state.toUpperCase()}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-[var(--ff-text-secondary)]">
        {editing ? (
          <>
            <input
              value={editOwner}
              onChange={e => setEditOwner(e.target.value)}
              placeholder="Owner"
              className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded px-2 py-1 text-xs text-[var(--ff-text-primary)] w-32"
              aria-label="Edit owner"
            />
            <input
              value={editDue}
              onChange={e => setEditDue(e.target.value)}
              placeholder="Due (YYYY-MM-DD)"
              className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded px-2 py-1 text-xs text-[var(--ff-text-primary)] w-36"
              aria-label="Edit due date"
            />
          </>
        ) : (
          <>
            {action.owner && <span>Owner: <strong>{action.owner}</strong></span>}
            {action.due && <span>Due: <strong>{action.due}</strong></span>}
          </>
        )}
        <span className={confidenceColor(action.confidence)}>
          Confidence: {confidenceLabel(action.confidence)} ({Math.round(action.confidence * 100)}%)
        </span>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />{mutation.error.message}
        </p>
      )}

      <PermissionGate permission="cortex.review" action="edit">
        <div className="flex gap-2 pt-1">
          {editing ? (
            <>
              <button
                onClick={() => run({
                  op: 'edit', actionId: action.action_id,
                  text: editText, owner: editOwner || undefined, due: editDue || undefined,
                })}
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
            </>
          ) : (
            <>
              <button
                onClick={() => run({ op: 'approve', actionId: action.action_id })}
                disabled={busy || action.state === 'approved'}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-green-600/20 text-green-500 hover:bg-green-600/30 rounded-lg transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Approve
              </button>
              <button
                onClick={() => run({ op: 'reject', actionId: action.action_id })}
                disabled={busy || action.state === 'rejected'}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Reject
              </button>
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            </>
          )}
        </div>
      </PermissionGate>
    </div>
  );
}

interface UnsealedPanelViewProps {
  meetingId: string;
  data: UnsealedPanel;
}

export function UnsealedPanelView({ meetingId, data }: UnsealedPanelViewProps) {
  const { proposedActions, minutes } = data;
  const [showQuotes, setShowQuotes] = useState<Record<string, boolean>>({});
  const publish = useCortexReviewMutation(meetingId);

  const approvedCount = proposedActions.filter(a => a.state === 'approved').length;
  const totalCount = proposedActions.length;
  const minutesText = (minutes ?? [])
    .filter(m => !m.superseded_by)
    .map(m => m.text)
    .join('\n')
    .trim();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
          Cortex Scribe — Proposed Actions
        </h3>
        <span className="text-xs text-[var(--ff-text-secondary)]">
          {approvedCount}/{totalCount} approved
        </span>
      </div>

      {minutesText && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
          <p className="text-xs font-semibold text-[var(--ff-text-secondary)] mb-1">Meeting Minutes</p>
          <p className="text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap line-clamp-6">
            {minutesText}
          </p>
        </div>
      )}

      {proposedActions.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-secondary)]">No proposed actions for this meeting yet.</p>
      ) : (
        <div className="space-y-3">
          {proposedActions.map(action => (
            <div key={action.action_id}>
              <ActionCard action={action} meetingId={meetingId} />
              {action.source_quotes?.length > 0 && (
                <div className="mt-1 ml-4">
                  <button
                    onClick={() => setShowQuotes(prev => ({ ...prev, [action.action_id]: !prev[action.action_id] }))}
                    className="flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
                  >
                    {showQuotes[action.action_id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {action.source_quotes.length} source quote{action.source_quotes.length !== 1 ? 's' : ''}
                  </button>
                  {showQuotes[action.action_id] && (
                    <ul className="mt-1 space-y-1">
                      {action.source_quotes.map((q, i) => (
                        <li key={`${action.action_id}-${i}`} className="text-xs text-[var(--ff-text-secondary)] italic border-l-2 border-[var(--ff-border-light)] pl-2">
                          {q}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {publish.isError && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />{publish.error.message}
        </p>
      )}

      <PermissionGate permission="cortex.review" action="edit">
        <button
          onClick={() => publish.mutate({ op: 'publish' })}
          disabled={publish.isPending || approvedCount === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={approvedCount === 0 ? 'Approve at least one action before publishing' : 'Seal this meeting as published'}
        >
          {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {publish.isPending ? 'Publishing…' : `Publish (${approvedCount} approved)`}
        </button>
      </PermissionGate>
    </div>
  );
}
