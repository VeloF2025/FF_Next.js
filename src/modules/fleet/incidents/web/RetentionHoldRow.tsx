/**
 * One retention hold, and — when the viewer may manage it — the controls that
 * act on that hold alone (stage 8, task 9b).
 *
 * Holds are unique per (incident, category) while active, so an incident can
 * carry several at once: a legal hold and an insurance hold are different
 * obligations, ending on different days, released by different people. Each
 * therefore gets its OWN note, review date and buttons. A single shared form
 * beneath a list of holds cannot say which hold it is about, and "Release"
 * with no subject is the one label you must not guess at when the effect is to
 * make an incident deletable.
 *
 * Split from `RetentionHoldPanel` to keep both under the component size limit.
 */
import { useState } from 'react';
import type { RetentionHold } from '../analytics/types';
import { formatSastDate, sastDayStartInstant } from './retentionHoldDates';
import { CATEGORY_LABELS } from './retentionHoldLabels';

const FIELD = 'px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] '
  + 'border border-[var(--ff-border-light)] rounded';
const BUTTON = 'px-3 py-1.5 text-xs border border-[var(--ff-border-light)] rounded '
  + 'hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]';

export interface RetentionHoldRowProps {
  hold: RetentionHold;
  /** Server-decided. Without it the row renders the state and none of the controls. */
  canManage: boolean;
  pending: boolean;
  onReview: (holdId: string, body: { note: string; nextReviewAt: string }) => void;
  onRelease: (holdId: string, body: { releaseReason: string }) => void;
}

export function RetentionHoldRow({ hold, canManage, pending, onReview, onRelease }: RetentionHoldRowProps) {
  const [note, setNote] = useState('');
  const [nextReviewDay, setNextReviewDay] = useState('');
  const label = CATEGORY_LABELS[hold.category];
  const isActive = hold.status === 'active';

  return (
    <li className="border-l-2 border-[var(--ff-border-light)] pl-3 py-1 space-y-1">
      <p className="text-sm text-[var(--ff-text-primary)]">
        {label}
        <span className={`ml-2 text-xs px-2 py-0.5 rounded bg-[var(--ff-bg-tertiary)] ${
          isActive ? 'text-amber-700' : 'text-[var(--ff-text-tertiary)]'}`}
        >
          {isActive ? 'Held' : 'Released'}
        </span>
      </p>
      <p className="text-xs text-[var(--ff-text-secondary)]">{hold.reason}</p>
      <p className="text-[10px] text-[var(--ff-text-tertiary)]">
        Next review {formatSastDate(hold.nextReviewAt)}
        {hold.lastReviewedAt && <> · last reviewed {formatSastDate(hold.lastReviewedAt)}</>}
      </p>

      {canManage && isActive && (
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            data-testid={`hold-note-${hold.category}`} aria-label={`Note for the ${label} hold`}
            value={note} placeholder="Note or release reason"
            onChange={(event) => setNote(event.target.value)}
            className={`${FIELD} flex-1 min-w-[12rem]`}
          />
          <input
            data-testid={`hold-next-review-${hold.category}`} aria-label={`Next review date for the ${label} hold`}
            type="date" value={nextReviewDay}
            onChange={(event) => setNextReviewDay(event.target.value)}
            className={FIELD}
          />
          <button
            type="button" data-testid={`hold-review-${hold.category}`} disabled={pending}
            onClick={() => {
              // A review with no note cannot be read by anyone but its author,
              // and one with no date never comes back for a decision. The day
              // becomes an instant here: the server refuses a bare date.
              const nextReviewAt = sastDayStartInstant(nextReviewDay);
              if (!note.trim() || nextReviewAt === null) return;
              onReview(hold.id, { note: note.trim(), nextReviewAt });
            }}
            className={BUTTON}
          >
            Review / extend {label}
          </button>
          <button
            type="button" data-testid={`hold-release-${hold.category}`} disabled={pending}
            onClick={() => {
              if (!note.trim()) return;
              onRelease(hold.id, { releaseReason: note.trim() });
            }}
            className="px-3 py-1.5 text-xs border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-tertiary)] text-red-700"
          >
            Release {label}
          </button>
        </div>
      )}
    </li>
  );
}
