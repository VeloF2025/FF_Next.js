const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 4 * 60_000, 8 * 60_000, 16 * 60_000];

/** Returns the next retry time for a one-based attempt count, or null when exhausted. */
export function nextRetryAt(
  now: Date,
  attempt: number,
  retryAfterSeconds?: number,
): Date | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > RETRY_DELAYS_MS.length) {
    return null;
  }
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && (retryAfterSeconds ?? 0) > 0
    ? (retryAfterSeconds as number) * 1_000
    : 0;
  const delayMs = Math.max(RETRY_DELAYS_MS[attempt - 1] ?? 0, retryAfterMs);
  return new Date(now.getTime() + delayMs);
}
