import * as Sentry from '@sentry/nextjs';

export interface TagContext {
  requestId?: string;
  route?: string;
}

/**
 * Strip query string from a request URL for bounded tag cardinality + PII hygiene.
 */
export function sanitizeRoute(url: string | undefined): string {
  if (!url) return 'unknown';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Stamp per-request tags on the current Sentry scope. No-op when SDK is dark.
 */
export function setTags({ requestId, route }: TagContext): void {
  if (process.env.SENTRY_ENABLED !== 'true') return;
  if (requestId) Sentry.setTag('request_id', requestId);
  if (route) Sentry.setTag('route', route);
}
