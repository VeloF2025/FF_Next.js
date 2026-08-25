/**
 * Browser client for the PR8 analytics/retention policy (stage 8, task 9b).
 *
 * Its own file for the same reason `retentionHoldApi` and `incidentTimelineApi`
 * are: `incidentApi.ts` is the queue, detail, settings and oversight client and
 * is already at its size limit. Envelope handling is shared through
 * `incidentRequest`.
 */
import { incidentRequest } from './incidentApi';
import type { RetentionPolicy } from '../analytics/types';
import type { AnalyticsRetentionSettingsChangeRequest } from '../analytics/retentionSettingsValidation';

const PATH = '/api/fleet/incidents/settings/retention-analytics';

export type { AnalyticsRetentionSettingsChangeRequest };

export const retentionSettingsApi = {
  get(signal?: AbortSignal): Promise<RetentionPolicy> {
    return incidentRequest<RetentionPolicy>(PATH, { signal });
  },

  version(body: AnalyticsRetentionSettingsChangeRequest): Promise<RetentionPolicy> {
    return incidentRequest<RetentionPolicy>(PATH, { method: 'POST', body: JSON.stringify(body) });
  },
};
