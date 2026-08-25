/**
 * Browser client for retention holds (stage 8, task 9b).
 *
 * Split out of `incidentApi.ts` for the same reason `incidentTimelineApi.ts`
 * was: that file is the queue, detail, settings and oversight client and is
 * already at its size limit. It shares that file's envelope handling through
 * `incidentRequest` rather than repeating it — one `{success,data}` decoder,
 * one `IncidentApiError` classification.
 */
import { incidentRequest } from './incidentApi';
import type { RetentionHold, RetentionHoldAction } from '../analytics/types';
import type { RetentionHoldCategory } from '../analytics/aggregateSchema';

export interface IncidentHoldsView {
  holds: RetentionHold[];
  actions: RetentionHoldAction[];
  /**
   * From the SERVER. A scoped viewer without hold authority sees that the
   * incident is held and none of the controls; the panel never decides this
   * for itself, because a client-side guess about authority is a guess that
   * can be wrong in the permissive direction.
   */
  canManage: boolean;
}

export interface CreateHoldBody {
  category: RetentionHoldCategory;
  reason: string;
  ownerUserId: string;
  nextReviewAt: string;
}

function holdsPath(incidentId: string): string {
  return `/api/fleet/incidents/${encodeURIComponent(incidentId)}/retention-holds`;
}

export const retentionHoldApi = {
  list(incidentId: string, signal?: AbortSignal): Promise<IncidentHoldsView> {
    return incidentRequest<IncidentHoldsView>(holdsPath(incidentId), { signal });
  },

  create(incidentId: string, body: CreateHoldBody): Promise<RetentionHold> {
    return incidentRequest<RetentionHold>(holdsPath(incidentId), {
      method: 'POST', body: JSON.stringify(body),
    });
  },

  review(incidentId: string, holdId: string, body: { note: string; nextReviewAt: string }): Promise<RetentionHold> {
    return incidentRequest<RetentionHold>(`${holdsPath(incidentId)}/${encodeURIComponent(holdId)}/review`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },

  release(incidentId: string, holdId: string, body: { releaseReason: string }): Promise<RetentionHold> {
    return incidentRequest<RetentionHold>(`${holdsPath(incidentId)}/${encodeURIComponent(holdId)}/release`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },
};
