/**
 * Generate an opaque request id for X-Request-Id headers and Sentry tags.
 * Uses crypto.randomUUID when available (Node 14.17+, edge runtimes).
 * Falls back to Math.random for legacy environments (never expected in prod).
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — 16 hex chars. Collision domain is per-request, not a security boundary.
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
