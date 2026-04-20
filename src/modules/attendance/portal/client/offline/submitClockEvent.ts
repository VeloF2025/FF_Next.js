/**
 * Submit a clock event with offline fallback.
 *
 * Unified behaviour:
 *   - If the browser is offline OR the fetch fails with NETWORK_ERROR,
 *     enqueue the event locally and resolve with `{ kind: 'queued' }`.
 *   - On 2xx, resolve with `{ kind: 'submitted', ... }` carrying the detail
 *     the UI shows on the success screen.
 *   - Everything else routes through `mapSubmitError` so the caller can
 *     render the same copy as a pure-online submit.
 *
 * Kept outside the React page so the state machine stays small and unit-
 * testable. No hooks here — the caller passes `online` and `refreshQueue`
 * in so the hook that owns the queue lifecycle stays single-responsibility.
 */

import { ApiError, ClockInResponse, ClockOutResponse, clockIn, clockOut } from '../api';
import { mapSubmitError, type ClockAction, type ErrorHandling } from '../clockErrors';
import { QueueFullError, enqueueClockEvent, type PendingClockEvent } from './db';

export interface ClockSubmitPayload {
  lat: number;
  lon: number;
  accuracyM: number;
  clientOccurredAt: string;
  selfieBase64: string;
  deviceFingerprint?: string;
}

export type ClockSubmitResult =
  | { kind: 'submitted_in'; response: ClockInResponse }
  | { kind: 'submitted_out'; response: ClockOutResponse }
  | { kind: 'queued' }
  | { kind: 'consent_required' }
  /** Event NOT saved — neither to the server nor to the offline queue.
   *  UI MUST render this as a failure, not a green check. */
  | { kind: 'not_saved'; message: string }
  | { kind: 'error'; message: string };

function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `clock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function enqueue(
  action: ClockAction,
  payload: ClockSubmitPayload
): Promise<ClockSubmitResult> {
  const event: PendingClockEvent = {
    id: newEventId(),
    action,
    lat: payload.lat,
    lon: payload.lon,
    accuracyM: payload.accuracyM,
    clientOccurredAt: payload.clientOccurredAt,
    selfieBase64: payload.selfieBase64,
    deviceFingerprint: payload.deviceFingerprint,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  try {
    await enqueueClockEvent(event);
    return { kind: 'queued' };
  } catch (err) {
    // Distinguish "queue is full" from "IDB is broken" from "unknown". Both
    // end states mean the event was NOT saved, and the UI copy must be
    // emphatic — a tired night-shift worker who sees "try again when
    // online" may interpret that as "will auto-retry" and walk away.
    if (err instanceof QueueFullError) {
      return { kind: 'not_saved', message: err.message };
    }
    const detail = err instanceof Error ? `: ${err.message}` : '';
    return {
      kind: 'not_saved',
      message:
        'Your clock event was NOT saved on this device. Screenshot this screen ' +
        'and contact your supervisor immediately' + detail + '.',
    };
  }
}

/**
 * Main entry point. Callers: pass `online=navigator.onLine` and inspect the
 * returned `ClockSubmitResult`. The caller owns UI state transitions.
 */
export async function submitClockEventWithOfflineFallback(
  action: ClockAction,
  payload: ClockSubmitPayload,
  options: { online: boolean }
): Promise<ClockSubmitResult> {
  if (!options.online) {
    return enqueue(action, payload);
  }
  try {
    if (action === 'in') {
      const response = await clockIn(payload);
      return { kind: 'submitted_in', response };
    }
    const response = await clockOut(payload);
    return { kind: 'submitted_out', response };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
      return enqueue(action, payload);
    }
    const mapped: ErrorHandling = mapSubmitError(err, action);
    if (mapped.kind === 'consent_required') return { kind: 'consent_required' };
    return { kind: 'error', message: mapped.message };
  }
}
