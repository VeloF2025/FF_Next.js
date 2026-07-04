// src/modules/noc/snag-resolve/offlineComplete.ts
/**
 * Network call for a queued 'complete_step' action, shaped for useOfflineQueue.
 * Throws with a `.status` on HTTP failure so the queue's default classifier
 * can decide drain-vs-keep (4xx like 400/409 drain; 5xx/network keep).
 */

import type { QueuedCompleteStep } from './types';

export async function submitCompleteStep(payload: QueuedCompleteStep): Promise<void> {
  const res = await fetch(`/api/snags/shared/${encodeURIComponent(payload.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'complete_step', stepId: payload.stepId, actorId: payload.actorId }),
  });
  if (!res.ok) {
    const err = new Error(`complete_step failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}
