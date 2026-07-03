/**
 * Pure flush engine for the generic offline queue. Generalised from
 * src/modules/attendance/portal/client/offline/sync.ts.
 *
 * Policy is CONSERVATIVE: keep by default, drain only on an explicit
 * permanent-failure signal from the consumer's classify(). An item that keeps
 * failing transiently is abandoned to the dropped store after the attempts cap
 * — so a corrupt row can't wedge the queue forever, and a new/unknown server
 * error can't silently delete a field submission.
 */

import type { FlushHooks, FlushReport, QueuedItem, SubmitResult } from './types';

export const MAX_ATTEMPTS_BEFORE_DRAIN = 10;

export type SubmitOne<TPayload> = (item: QueuedItem<TPayload>) => Promise<SubmitResult>;

export async function flushQueue<TPayload>(
  items: QueuedItem<TPayload>[],
  submit: SubmitOne<TPayload>,
  hooks: FlushHooks,
  maxAttempts: number = MAX_ATTEMPTS_BEFORE_DRAIN
): Promise<FlushReport> {
  const report: FlushReport = { attempted: 0, drained: 0, kept: 0, failures: [] };

  for (const item of items) {
    report.attempted++;

    if (item.attempts >= maxAttempts) {
      const reason = `Abandoned after ${item.attempts} failed attempts. Last error: ${
        item.lastError ?? 'unknown'
      }`;
      await hooks.onAbandon(item.id, reason);
      report.drained++;
      report.failures.push({ id: item.id, message: reason });
      continue;
    }

    try {
      const result = await submit(item);
      if (result.drain) {
        await hooks.onDrain(item.id, result.errorMessage ?? 'Dropped by server response');
        report.drained++;
        if (result.errorMessage) report.failures.push({ id: item.id, message: result.errorMessage });
      } else {
        const message = result.errorMessage ?? 'Transient failure';
        await hooks.onTransient(item.id, message);
        report.kept++;
        report.failures.push({ id: item.id, message });
        break; // don't burn the rest of the queue against a broken backend
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await hooks.onTransient(item.id, message);
      report.kept++;
      report.failures.push({ id: item.id, message });
      break;
    }
  }

  return report;
}

/**
 * Default classifier used when a consumer config omits `classify`. Conservative:
 * only an explicit HTTP status carried on the error drains; everything else is
 * kept and retried. Consumers with richer server-reason codes pass their own.
 */
export function defaultClassify(err: unknown): SubmitResult {
  const status = (err as { status?: number } | undefined)?.status;
  // 400/409 are the only "user can't fix by retrying" defaults; keep the rest.
  if (status === 400 || status === 409) {
    return { drain: true, errorMessage: (err as Error)?.message || `Rejected (${status}).` };
  }
  return { drain: false, errorMessage: err instanceof Error ? err.message : 'Will retry.' };
}
