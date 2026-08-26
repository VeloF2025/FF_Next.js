/**
 * Retention holds on one incident (stage 8, task 9b).
 *
 * A hold is what stops an incident being deleted at the end of the retention
 * window, so the fact that one exists is shown to everyone who can open the
 * incident. Acting on it is a different privilege, and it is TWO privileges:
 * `canCreate` and `canManage` both come from the server, mapped to the
 * `create` and `edit` actions the hold service checks. The panel never infers
 * authority — a client-side guess is one that can be wrong in the permissive
 * direction, and offering a button the server will refuse is the same bug.
 *
 * Every action waits for the server before the panel shows it as done.
 * Releasing a hold makes an incident deletable again, and a manager who is
 * shown "released" for something that failed has been told the opposite of
 * what happened.
 */
import { useCallback, useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import { IncidentApiError, isIncidentApiAbort } from './incidentApi';
import { RetentionHoldCreateForm } from './RetentionHoldCreateForm';
import { RetentionHoldRow } from './RetentionHoldRow';
import { retentionHoldApi } from './retentionHoldApi';
import type { CreateHoldBody, IncidentHoldsView } from './retentionHoldApi';
import { RETENTION_HOLD_CATEGORIES } from '../analytics/aggregateSchema';
import type { RetentionHoldCategory } from '../analytics/aggregateSchema';

export interface RetentionHoldPanelProps {
  incidentId: string;
  /** Bumped by the drawer so a hold raised elsewhere in the session is picked up. */
  refreshKey?: number;
}

export function RetentionHoldPanel({ incidentId, refreshKey = 0 }: RetentionHoldPanelProps) {
  const [view, setView] = useState<IncidentHoldsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const loaded = await retentionHoldApi.list(incidentId, signal);
      // A response that is not the holds view is an error, not an empty one.
      // Rendering it would either crash the drawer this panel sits in on
      // `holds.map` or — worse — show "no hold on this incident" for an
      // answer nobody gave.
      if (!Array.isArray(loaded?.holds)) {
        throw new IncidentApiError('Retention holds response was invalid', 0, 'INVALID_RESPONSE');
      }
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
    } catch (cause: unknown) {
      setError(cause instanceof IncidentApiError ? cause.message : 'That retention hold action failed');
      log.error('Fleet retention hold action failed', { error: cause }, 'fleet');
    } finally {
      setPending(false);
    }
  }, [load]);

  const holds = view?.holds ?? [];
  const held = new Set(holds.filter((hold) => hold.status === 'active').map((hold) => hold.category));
  // Active holds are unique per category, so what remains to be placed is
  // every category that is not currently held.
  const available = RETENTION_HOLD_CATEGORIES.filter(
    (category: RetentionHoldCategory) => !held.has(category),
  );

  return (
    <section data-testid="retention-holds" className="space-y-2">
      <h4 className="text-xs font-semibold text-[var(--ff-primary)] uppercase tracking-wide">Retention holds</h4>

      {error !== null && <p role="alert" data-testid="hold-error" className="text-sm text-red-700">{error}</p>}

      {view !== null && holds.length === 0 && (
        <p className="text-xs text-[var(--ff-text-secondary)]">
          No hold on this incident. It will be purged with everything else once the retention window passes.
        </p>
      )}

      {holds.length > 0 && (
        <ul className="space-y-1">
          {holds.map((hold) => (
            <RetentionHoldRow
              key={hold.id} hold={hold} canManage={view?.canManage === true} pending={pending}
              onReview={(holdId, body) => { void run(() => retentionHoldApi.review(incidentId, holdId, body)); }}
              onRelease={(holdId, body) => { void run(() => retentionHoldApi.release(incidentId, holdId, body)); }}
            />
          ))}
        </ul>
      )}

      {view?.canCreate === true && available.length > 0 && (
        <RetentionHoldCreateForm
          // Remounted when the set of free categories changes, so the select
          // never keeps a default that has since been taken.
          key={available.join(',')}
          available={available} pending={pending}
          onCreate={(body: CreateHoldBody) => { void run(() => retentionHoldApi.create(incidentId, body)); }}
        />
      )}
    </section>
  );
}
