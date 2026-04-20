/**
 * Pure sync engine for the offline clock-event queue.
 *
 * Classification policy is **conservative**: we keep events by default and
 * only drain on an explicit allowlist of reasons that cannot be fixed by
 * retrying later. This inverts an earlier version that drained all unknown
 * 4xx — the old default silently lost shifts whenever a transient 429 or a
 * new server reason code was introduced.
 *
 * `MAX_ATTEMPTS_BEFORE_DRAIN` is the safety valve: an event that keeps
 * failing transiently gets moved to the dropped-events store with a typed
 * reason so the user / supervisor can see it. Without this, a corrupt row
 * throwing TypeError every flush would wedge the queue forever.
 */

import { ApiError } from '../api';
import type { PendingClockEvent } from './db';

export const MAX_ATTEMPTS_BEFORE_DRAIN = 10;

export type ClockAction = 'in' | 'out';

export interface SubmitResult {
  /** True when the event should be removed from the queue. */
  drain: boolean;
  /** Human-readable message; shown to the user AND persisted on the
   *  dropped-events row when `drain` is true. */
  errorMessage?: string;
}

export type SubmitClockEvent = (event: PendingClockEvent) => Promise<SubmitResult>;

export interface FlushReport {
  attempted: number;
  drained: number;
  kept: number;
  failures: Array<{ id: string; message: string }>;
}

export interface FlushHooks {
  /** Drop an event from pending and persist a dropped-row with `reason`. */
  onDrain: (id: string, reason: string) => Promise<void>;
  /** Increment the attempts counter + store the last error message. */
  onTransient: (id: string, message: string) => Promise<void>;
  /** Attempts cap exceeded — treat as drain + persist a dropped-row so the
   *  user can see what happened. */
  onAbandon: (id: string, reason: string) => Promise<void>;
}

export async function flushQueue(
  events: PendingClockEvent[],
  submit: SubmitClockEvent,
  hooks: FlushHooks
): Promise<FlushReport> {
  const report: FlushReport = { attempted: 0, drained: 0, kept: 0, failures: [] };

  for (const event of events) {
    report.attempted++;

    // Safety valve: if this event has already failed too many times, escalate
    // to "abandoned" before spending another bcrypt/network round-trip on it.
    if (event.attempts >= MAX_ATTEMPTS_BEFORE_DRAIN) {
      const reason = `Abandoned after ${event.attempts} failed attempts. Last error: ${
        event.lastError ?? 'unknown'
      }`;
      await hooks.onAbandon(event.id, reason);
      report.drained++;
      report.failures.push({ id: event.id, message: reason });
      continue;
    }

    try {
      const result = await submit(event);
      if (result.drain) {
        await hooks.onDrain(event.id, result.errorMessage ?? 'Dropped by server response');
        report.drained++;
        if (result.errorMessage) {
          report.failures.push({ id: event.id, message: result.errorMessage });
        }
      } else {
        const message = result.errorMessage ?? 'Transient failure';
        await hooks.onTransient(event.id, message);
        report.kept++;
        report.failures.push({ id: event.id, message });
        // Early-exit: don't burn the rest of the queue against a broken backend.
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await hooks.onTransient(event.id, message);
      report.kept++;
      report.failures.push({ id: event.id, message });
      break;
    }
  }

  return report;
}

/**
 * Map an ApiError to drain/keep. Policy:
 *
 *   DRAIN — the user cannot succeed by retrying later:
 *     - 400 clock_skew    (captured timestamp was out of range at capture;
 *                          re-submitting days later doesn't help)
 *     - 409 open_entry (on clock-in only; duplicate)
 *
 *   KEEP — user action or time will resolve:
 *     - 401                     → session expired; wait for re-login
 *     - 403 consent_*           → user must re-grant consent
 *     - 404 no_open_entry (on clock-out) → we cannot tell locally whether
 *       the server has our clock-in for this staff or not; keeping the
 *       event + letting the attempts cap handle true dead-ends is safer
 *       than silently dropping a shift-end
 *     - 0 NETWORK_ERROR         → offline
 *     - 408 / 425 / 429         → transient (timeout / rate limit)
 *     - 5xx                     → transient server issue
 *     - any other 4xx           → keep by default; attempts cap eventually
 *       abandons it with a persistent dropped-row (so a new server reason
 *       code doesn't silently delete shifts)
 *
 * This is **conservative**: it means a genuinely-permanent server-side
 * validation error will sit in the queue and burn attempts before being
 * abandoned. The cost of that retry budget is a few extra network calls;
 * the cost of the alternative (drain unknown 4xx) is a lost shift.
 */
export function classifyApiError(err: ApiError, action: ClockAction): SubmitResult {
  const reason = (err.details as { reason?: string } | undefined)?.reason;

  if (err.status === 400 && reason === 'clock_skew') {
    return {
      drain: true,
      errorMessage: 'Dropped queued event: your phone time was off at the time of capture.',
    };
  }
  if (err.status === 409 && reason === 'open_entry' && action === 'in') {
    return {
      drain: true,
      errorMessage: 'Dropped queued clock-in: you already had an open shift.',
    };
  }

  if (err.status === 401) {
    return { drain: false, errorMessage: 'Signed out — sign in again to finish syncing.' };
  }
  if (err.status === 403 && reason?.startsWith('consent')) {
    return { drain: false, errorMessage: 'Consent is required before queued events can sync.' };
  }
  if (err.code === 'NETWORK_ERROR') {
    return { drain: false, errorMessage: 'Offline' };
  }
  if (err.status === 408 || err.status === 425 || err.status === 429) {
    return { drain: false, errorMessage: 'Server busy — will retry.' };
  }
  if (err.status >= 500) {
    return { drain: false, errorMessage: 'Server error — will retry.' };
  }

  // Unknown 4xx (inc. 404 no_open_entry on clock-out): keep + let the
  // attempts cap handle true dead-ends. The user will see the event count
  // tick up in the "Recently dropped" list once MAX_ATTEMPTS is hit.
  return { drain: false, errorMessage: err.message || 'Unexpected response — will retry.' };
}
