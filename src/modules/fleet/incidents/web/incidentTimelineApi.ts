/**
 * Browser client for the incident chronology (stage 8, task 6).
 *
 * Split out of `incidentApi.ts` rather than added to it: that file is the queue,
 * detail, settings, and oversight client and is already at its size limit, and
 * the chronology is read by one component on its own request. It shares that
 * file's envelope handling through `incidentRequest` rather than repeating it —
 * one `{success,data}` decoder, one `IncidentApiError` classification.
 */
import { incidentRequest } from './incidentApi';
import type { IncidentTimelinePage } from '../analytics/types';

export const incidentTimelineApi = {
  /**
   * One page of the chronology. Loaded on demand rather than folded into the
   * detail read: the drawer is usable without it, and an incident with a long
   * history should not slow down every open.
   *
   * `signal` is not optional in practice — the caller re-reads on every incident
   * change, and a response that outlives the incident it was asked for must be
   * abandoned rather than rendered.
   */
  timeline(incidentId: string, cursor?: string | null, signal?: AbortSignal): Promise<IncidentTimelinePage> {
    const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return incidentRequest<IncidentTimelinePage>(
      `/api/fleet/incidents/${encodeURIComponent(incidentId)}/timeline${params}`, { signal },
    );
  },
};
