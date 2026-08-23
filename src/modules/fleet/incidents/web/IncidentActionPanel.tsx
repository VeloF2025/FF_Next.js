/**
 * Transition/outcome/note validation UI (Task 8 split from
 * `IncidentReviewDrawer.tsx`, which owns fetching and every read-only
 * section). Reflects the exact lifecycle matrix enforced server-side in
 * `reviewTransitions.ts`: `open` -> acknowledge/comment, `acknowledged` ->
 * start review/comment, `under_review` -> comment/resolve/dismiss, and no
 * controls at all once the incident is terminal (`resolved`/`dismissed`
 * reject every action, including `commented`).
 *
 * A failed submission never clears the draft — `note`/`outcome`/
 * `linkedIncidentReference` stay exactly as typed so the manager can fix an
 * evidence-required rejection and resubmit without retyping (this task's
 * hard requirement). Success is only signalled after the API confirms it.
 *
 * PR7 Task 8 adds `RequestDriverInputSection` (design §6): unlike the
 * transition controls above, it renders whenever `canEdit` is true —
 * including once the incident is terminal, since the post-closure request
 * policy is a server-side setting (`fleet_incident_driver_input_settings`),
 * not a client-side lifecycle gate.
 */
import { useState } from 'react';
import { incidentApi, IncidentApiError, type IncidentActionBody } from './incidentApi';
import { OUTCOME_LABELS } from './incidentLabels';
import type { IncidentDetail, IncidentOutcome } from '../types';

function sast(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : 'Not recorded';
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function RequestDriverInputSection({ incidentId }: { incidentId: string }) {
  const [guidance, setGuidance] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedRespondBy, setRequestedRespondBy] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const result = await incidentApi.requestDriverInput(incidentId, { guidance: guidance.trim() || null, idempotencyKey });
      setRequestedRespondBy(result.respondBy);
      setGuidance('');
      setIdempotencyKey(newIdempotencyKey());
    } catch (caught) {
      setError(caught instanceof IncidentApiError ? caught.message : 'Could not request driver input');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="Request driver input" className="space-y-2 rounded border border-[var(--ff-border-light)] p-3">
      <h4 className="font-medium text-[var(--ff-text-primary)]">Request driver input</h4>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {requestedRespondBy && <p role="status" className="text-sm text-[var(--ff-text-secondary)]">Requested — response due {sast(requestedRespondBy)}.</p>}
      <label className="block text-sm">Guidance for the driver (optional)
        <textarea aria-label="Driver guidance" value={guidance} onChange={(event) => setGuidance(event.target.value)} className="mt-1 block w-full" />
      </label>
      <button type="button" disabled={submitting} onClick={() => void submit()} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm disabled:opacity-50">
        {submitting ? 'Requesting…' : 'Request driver input'}
      </button>
    </section>
  );
}

const RESOLVED_OUTCOMES: readonly IncidentOutcome[] = ['confirmed', 'valid_reason', 'assignment_error', 'geofence_error', 'no_action_required'];
const DISMISSED_OUTCOMES: readonly IncidentOutcome[] = ['false_positive', 'data_gap', 'duplicate'];

type AvailableAction = 'acknowledged' | 'review_started' | 'commented' | 'resolved' | 'dismissed';

function availableActions(incident: IncidentDetail): AvailableAction[] {
  switch (incident.lifecycleStatus) {
    case 'open': return ['acknowledged', 'commented'];
    case 'acknowledged': return ['review_started', 'commented'];
    case 'under_review': return ['commented', 'resolved', 'dismissed'];
    default: return [];
  }
}

export interface IncidentActionPanelProps {
  incident: IncidentDetail;
  canEdit: boolean;
  onSubmitted: () => void;
}

export function IncidentActionPanel({ incident, canEdit, onSubmitted }: IncidentActionPanelProps) {
  const actions = availableActions(incident);
  const [actionType, setActionType] = useState<AvailableAction | ''>('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<IncidentOutcome | ''>('');
  const [linkedIncidentReference, setLinkedIncidentReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return <p className="text-sm text-[var(--ff-text-secondary)]">You do not have permission to act on this incident.</p>;

  const terminal = actionType === 'resolved' || actionType === 'dismissed';
  const outcomeOptions = actionType === 'resolved' ? RESOLVED_OUTCOMES : actionType === 'dismissed' ? DISMISSED_OUTCOMES : [];
  const noteRequired = actionType === 'commented' || terminal;
  const valid = Boolean(actionType) && (!noteRequired || note.trim())
    && (!terminal || outcome) && (outcome !== 'duplicate' || linkedIncidentReference.trim());

  async function submit(): Promise<void> {
    if (!actionType || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: IncidentActionBody = {
        actionType, note: note.trim() || null, outcome: terminal ? (outcome as IncidentOutcome) : null,
        linkedIncidentReference: outcome === 'duplicate' ? linkedIncidentReference.trim() : null,
      };
      await incidentApi.act(incident.id, body);
      setActionType(''); setNote(''); setOutcome(''); setLinkedIncidentReference('');
      onSubmitted();
    } catch (caught) {
      setError(caught instanceof IncidentApiError ? caught.message : 'Could not save this action');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {actions.length ? (
        <section aria-label="Incident actions" className="space-y-3 rounded border border-[var(--ff-border-light)] p-3">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button key={action} type="button" aria-pressed={actionType === action}
                onClick={() => setActionType(action)}
                className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm capitalize">
                {action.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
          {actionType && (
            <div className="space-y-2">
              {terminal && (
                <label className="block text-sm">Outcome
                  <select aria-label="Outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as IncidentOutcome)} className="mt-1 block w-full">
                    <option value="">Select an outcome</option>
                    {outcomeOptions.map((item) => <option key={item} value={item}>{OUTCOME_LABELS[item]}</option>)}
                  </select>
                </label>
              )}
              {outcome === 'duplicate' && (
                <label className="block text-sm">Linked incident reference
                  <input aria-label="Linked incident reference" value={linkedIncidentReference}
                    onChange={(event) => setLinkedIncidentReference(event.target.value)} className="mt-1 block w-full" />
                </label>
              )}
              <label className="block text-sm">Note{noteRequired ? '' : ' (optional)'}
                <textarea aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 block w-full" />
              </label>
              <button type="button" disabled={!valid || submitting} onClick={() => void submit()} className="rounded bg-[var(--ff-primary)] px-3 py-2 text-sm text-white disabled:opacity-50">
                {submitting ? 'Saving…' : 'Submit'}
              </button>
            </div>
          )}
        </section>
      ) : (
        <p className="text-sm text-[var(--ff-text-secondary)]">This incident is closed. No further action is available.</p>
      )}
      <RequestDriverInputSection incidentId={incident.id} />
    </>
  );
}
