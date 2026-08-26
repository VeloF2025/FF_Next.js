/**
 * Placing a new retention hold on an incident (stage 8, task 9b).
 *
 * Only the categories not already held are offered. The partial unique index
 * on (incident_id, category) refuses a second active hold in the same
 * category, so offering one is offering a request that is guaranteed to come
 * back a conflict — and the form disappears only when every category is
 * spoken for, not as soon as one hold exists.
 *
 * Split from `RetentionHoldPanel` to keep both under the component size limit.
 */
import { useState } from 'react';
import { incidentApi } from './incidentApi';
import { IncidentIdFilter } from './IncidentIdFilter';
import { CATEGORY_LABELS } from './retentionHoldLabels';
import { sastDayStartInstant } from './retentionHoldDates';
import type { CreateHoldBody } from './retentionHoldApi';
import type { RetentionHoldCategory } from '../analytics/aggregateSchema';

const FIELD = 'px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] '
  + 'border border-[var(--ff-border-light)] rounded';

export interface RetentionHoldCreateFormProps {
  /** The categories with no active hold on this incident. Never empty — the panel hides the form instead. */
  available: RetentionHoldCategory[];
  pending: boolean;
  onCreate: (body: CreateHoldBody) => void;
}

export function RetentionHoldCreateForm({ available, pending, onCreate }: RetentionHoldCreateFormProps) {
  const [category, setCategory] = useState<RetentionHoldCategory>(available[0]!);
  const [reason, setReason] = useState('');
  const [nextReviewDay, setNextReviewDay] = useState('');
  /**
   * The owner is a real person who answers for the hold, and the server
   * requires an active FibreFlow user. It is deliberately NOT defaulted to the
   * creator — `createdBy` already records who placed it, and a legal hold's
   * owner is frequently not the manager who happened to notice the incident.
   */
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(undefined);

  // A category can stop being available while the form is open — someone else
  // placed that hold. Falling back keeps the select from submitting a value it
  // no longer offers.
  const selected = available.includes(category) ? category : available[0]!;

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap gap-2">
        <div data-testid="hold-owner" className="min-w-[12rem]">
          <IncidentIdFilter
            label="Owner" value={ownerUserId} onChange={setOwnerUserId}
            search={incidentApi.searchActiveUsers} resolveById={async (id) => {
              const [match] = await incidentApi.resolveOversightUserNames([id]);
              return match ?? null;
            }}
          />
        </div>
        <select
          data-testid="hold-category" aria-label="Hold category" value={selected}
          onChange={(event) => setCategory(event.target.value as RetentionHoldCategory)}
          className={FIELD}
        >
          {available.map((value) => (
            <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
          ))}
        </select>
        <input
          data-testid="hold-reason" aria-label="Hold reason" value={reason}
          placeholder="Why this must be kept"
          onChange={(event) => setReason(event.target.value)}
          className={`${FIELD} flex-1 min-w-[12rem]`}
        />
        <input
          data-testid="hold-next-review" aria-label="Next review date" type="date" value={nextReviewDay}
          onChange={(event) => setNextReviewDay(event.target.value)}
          className={FIELD}
        />
      </div>

      <button
        type="button" data-testid="hold-create" disabled={pending}
        onClick={() => {
          // All three required. A hold with no stated reason cannot be reviewed
          // by anyone but its author, one with no review date never comes back
          // for a decision, and the server refuses an owner that is not an
          // active user — so an unset owner is a request that would fail after
          // the click. The date becomes an instant here, because the server
          // parses `nextReviewAt` strictly and refuses a bare calendar day.
          const nextReviewAt = sastDayStartInstant(nextReviewDay);
          if (!reason.trim() || nextReviewAt === null || !ownerUserId) return;
          onCreate({ category: selected, reason: reason.trim(), ownerUserId, nextReviewAt });
        }}
        className="px-3 py-1.5 text-xs border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
      >
        Place hold
      </button>
    </div>
  );
}
