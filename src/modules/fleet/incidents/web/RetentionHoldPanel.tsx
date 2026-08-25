/**
 * Retention holds on one incident (stage 8, task 9b).
 *
 * A hold is what stops an incident being deleted at the end of the retention
 * window, so the fact that one exists is shown to everyone who can open the
 * incident. Acting on it is a different privilege: `canManage` comes from the
 * server, and without it this renders the state and none of the controls. The
 * panel never infers authority — a client-side guess is one that can be wrong
 * in the permissive direction.
 *
 * Every action waits for the server before the panel shows it as done.
 * Releasing a hold makes an incident deletable again, and a manager who is
 * shown "released" for something that failed has been told the opposite of
 * what happened.
 */
import { useCallback, useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import { IncidentApiError, incidentApi, isIncidentApiAbort } from './incidentApi';
import { IncidentIdFilter } from './IncidentIdFilter';
import { retentionHoldApi } from './retentionHoldApi';
import type { IncidentHoldsView } from './retentionHoldApi';
import { RETENTION_HOLD_CATEGORIES } from '../analytics/aggregateSchema';
import type { RetentionHoldCategory } from '../analytics/aggregateSchema';
import type { RetentionHold } from '../analytics/types';

const CATEGORY_LABELS: Record<RetentionHoldCategory, string> = {
  health_safety: 'Health & safety', accident: 'Accident', insurance: 'Insurance',
  disciplinary: 'Disciplinary', legal: 'Legal', other_approved: 'Other (approved)',
};

function sast(value: string): string {
  return new Date(value).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
}

function HoldRow({ hold }: { hold: RetentionHold }) {
  return (
    <li className="border-l-2 border-[var(--ff-border-light)] pl-3 py-1">
      <p className="text-sm text-[var(--ff-text-primary)]">
        {CATEGORY_LABELS[hold.category]}
        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${hold.status === 'active'
          ? 'bg-amber-900/30 text-amber-300' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'}`}
        >
          {hold.status === 'active' ? 'Held' : 'Released'}
        </span>
      </p>
      <p className="text-xs text-[var(--ff-text-secondary)]">{hold.reason}</p>
      <p className="text-[10px] text-[var(--ff-text-tertiary)]">
        Next review {sast(hold.nextReviewAt)}
        {hold.lastReviewedAt && <> · last reviewed {sast(hold.lastReviewedAt)}</>}
      </p>
    </li>
  );
}

export interface RetentionHoldPanelProps {
  incidentId: string;
  /** Bumped by the drawer so a hold raised elsewhere in the session is picked up. */
  refreshKey?: number;
}

export function RetentionHoldPanel({ incidentId, refreshKey = 0 }: RetentionHoldPanelProps) {
  const [view, setView] = useState<IncidentHoldsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [category, setCategory] = useState<RetentionHoldCategory>('legal');
  const [reason, setReason] = useState('');
  const [nextReviewAt, setNextReviewAt] = useState('');
  /**
   * The owner is a real person who answers for the hold, and the server
   * requires an active FibreFlow user. It is deliberately NOT defaulted to the
   * creator — `createdBy` already records who placed it, and a legal hold's
   * owner is frequently not the manager who happened to notice the incident.
   */
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(undefined);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const loaded = await retentionHoldApi.list(incidentId, signal);
      // A response that is not the holds view is an error, not an empty one.
      // Rendering it would either crash the drawer this panel sits in or —
      // worse — show "no hold on this incident" for an answer nobody gave.
      if (!Array.isArray(loaded?.holds)) throw new IncidentApiError('Retention holds response was invalid', 0, 'INVALID_RESPONSE');
      setView(loaded);
      setError(null);
    } catch (cause: unknown) {
      if (isIncidentApiAbort(cause)) return;
      // Left null rather than defaulted to "no holds": an empty panel reads as
      // "nothing is holding this incident", which is the opposite of unknown.
      setError(cause instanceof IncidentApiError ? cause.message : 'Could not load retention holds');
      log.error('Fleet retention holds failed to load', { error: cause }, 'fleet');
    }
  }, [incidentId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  /** Runs one hold command, then re-reads. The panel shows nothing as done until both have. */
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await load();
      setReason('');
    } catch (cause: unknown) {
      setError(cause instanceof IncidentApiError ? cause.message : 'That retention hold action failed');
      log.error('Fleet retention hold action failed', { error: cause }, 'fleet');
    } finally {
      setPending(false);
    }
  }, [load]);

  const active = view?.holds.find((hold) => hold.status === 'active') ?? null;
  const canManage = view?.canManage === true;

  return (
    <section data-testid="retention-holds" className="space-y-2">
      <h4 className="text-xs font-semibold text-[var(--ff-primary)] uppercase tracking-wide">Retention holds</h4>

      {error !== null && <p data-testid="hold-error" className="text-sm text-red-300">{error}</p>}

      {view !== null && view.holds.length === 0 && (
        <p className="text-xs text-[var(--ff-text-secondary)]">
          No hold on this incident. It will be purged with everything else once the retention window passes.
        </p>
      )}

      {view !== null && view.holds.length > 0 && (
        <ul className="space-y-1">{view.holds.map((hold) => <HoldRow key={hold.id} hold={hold} />)}</ul>
      )}

      {canManage && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-2">
            {active === null && (
              <div data-testid="hold-owner" className="min-w-[12rem]">
                <IncidentIdFilter
                  label="Owner" value={ownerUserId} onChange={setOwnerUserId}
                  search={incidentApi.searchActiveUsers} resolveById={async (id) => {
                    const [match] = await incidentApi.resolveOversightUserNames([id]);
                    return match ?? null;
                  }}
                />
              </div>
            )}
            {active === null && (
              <select
                data-testid="hold-category" aria-label="Hold category" value={category}
                onChange={(event) => setCategory(event.target.value as RetentionHoldCategory)}
                className="px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded"
              >
                {RETENTION_HOLD_CATEGORIES.map((value) => (
                  <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
                ))}
              </select>
            )}
            <input
              data-testid="hold-reason" aria-label="Hold reason" value={reason}
              placeholder={active === null ? 'Why this must be kept' : 'Note or release reason'}
              onChange={(event) => setReason(event.target.value)}
              className="px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded flex-1 min-w-[12rem]"
            />
            <input
              data-testid="hold-next-review" aria-label="Next review date" type="date" value={nextReviewAt}
              onChange={(event) => setNextReviewAt(event.target.value)}
              className="px-2 py-1 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {active === null ? (
              <button
                type="button" data-testid="hold-create" disabled={pending}
                onClick={() => {
                  // All three required. A hold with no stated reason cannot be
                  // reviewed by anyone but its author, one with no review date
                  // never comes back for a decision, and the server refuses an
                  // owner that is not an active user — so an unset owner is a
                  // request that would fail after the click.
                  if (!reason.trim() || !nextReviewAt || !ownerUserId) return;
                  void run(() => retentionHoldApi.create(incidentId, {
                    category, reason: reason.trim(), ownerUserId, nextReviewAt,
                  }));
                }}
                className="px-3 py-1.5 text-xs border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
              >
                Place hold
              </button>
            ) : (
              <>
                <button
                  type="button" data-testid="hold-review" disabled={pending}
                  onClick={() => {
                    if (!reason.trim() || !nextReviewAt) return;
                    void run(() => retentionHoldApi.review(incidentId, active.id, {
                      note: reason.trim(), nextReviewAt,
                    }));
                  }}
                  className="px-3 py-1.5 text-xs border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
                >
                  Review / extend
                </button>
                <button
                  type="button" data-testid="hold-release" disabled={pending}
                  onClick={() => {
                    if (!reason.trim()) return;
                    void run(() => retentionHoldApi.release(incidentId, active.id, {
                      releaseReason: reason.trim(),
                    }));
                  }}
                  className="px-3 py-1.5 text-xs border border-red-800 rounded hover:bg-red-900/20 text-red-300"
                >
                  Release
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
