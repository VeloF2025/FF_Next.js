/**
 * WhatsApp alert builder for the nightly Cartrack reconcile cron.
 *
 * The cron already logs to stderr (which tails into
 * /home/velo/logs/attendance-cartrack-reconcile.log) and cron's MAILTO
 * picks up non-zero exits. Neither of those lands in front of ops first
 * thing in the morning. This module formats a compact summary and
 * forwards it to the attendance-ops WA group when any of three
 * thresholds trip:
 *
 *   1. rowsMismatch >= ATTENDANCE_WA_MISMATCH_THRESHOLD (default 5)
 *      — actionable supervisor work queued.
 *   2. perEntryErrors.length > 0
 *      — transient Cartrack / network errors that didn't crash the run.
 *   3. circuitBrokenAfter is set
 *      — we gave up mid-run because Cartrack was flaky.
 *
 * Alerts are BEST-EFFORT: a WA send failure logs and returns; it does
 * NOT tank the cron (the reconcile already completed at that point).
 *
 * Design split:
 *   - `shouldAlert` and `buildAlertMessage` are pure → unit tests don't
 *     need a WA stub.
 *   - `sendCartrackReconcileAlert` is the orchestrator — checks, formats,
 *     and delegates to `sendWhatsAppGroup` from the notifications module.
 */

import type { CartrackReconcileReport } from '@/services/attendance/cartrackReconcile';

export interface AlertOptions {
  /**
   * rowsMismatch threshold. >= this count triggers an alert for
   * actionable supervisor follow-up. Set very low (0) to alert on
   * every mismatch; set very high to alert only on surges.
   */
  mismatchThreshold: number;
}

export const DEFAULT_MISMATCH_THRESHOLD = 5;

/**
 * Pure predicate. Returns the list of reasons the report warrants
 * an alert; empty array means no alert. Callers that only want a
 * boolean can check `reasons.length > 0`.
 */
export function shouldAlert(
  report: CartrackReconcileReport,
  opts: AlertOptions
): string[] {
  const reasons: string[] = [];
  if (report.rowsMismatch >= opts.mismatchThreshold) {
    reasons.push(
      `mismatches=${report.rowsMismatch} (threshold=${opts.mismatchThreshold})`
    );
  }
  if (report.perEntryErrors.length > 0) {
    reasons.push(`perEntryErrors=${report.perEntryErrors.length}`);
  }
  if (report.circuitBrokenAfter !== undefined) {
    reasons.push(`circuitBrokenAfter=${report.circuitBrokenAfter}`);
  }
  return reasons;
}

/**
 * Pure formatter. Builds a short WA-readable summary. Kept narrow so
 * ops can skim on a phone; the log file has the full detail for
 * follow-up.
 */
export function buildAlertMessage(
  report: CartrackReconcileReport,
  reasons: string[]
): string {
  const lines: string[] = [];
  lines.push('*Cartrack reconcile — attention needed*');
  lines.push(`Scanned: ${report.scannedFrom}..${report.scannedTo}`);
  lines.push(`Entries: ${report.entriesConsidered}`);
  lines.push(
    `Match: ${report.rowsMatch} | Mismatch: ${report.rowsMismatch} | ` +
      `No-data: ${report.rowsNoData} | Not-mapped: ${report.rowsVehicleNotMapped}`
  );
  if (report.rowsDeviceGpsOff > 0) {
    lines.push(`Device-GPS-off: ${report.rowsDeviceGpsOff}`);
  }
  if (report.mismatchExceptionsRaised > 0) {
    lines.push(
      `Exceptions raised: ${report.mismatchExceptionsRaised} (supervisor review queue)`
    );
  }
  if (report.perEntryErrors.length > 0) {
    lines.push(`Per-entry errors: ${report.perEntryErrors.length}`);
  }
  if (report.circuitBrokenAfter !== undefined) {
    lines.push(`⚠️ Circuit broke after ${report.circuitBrokenAfter} entries`);
  }
  lines.push('');
  lines.push(`Trigger: ${reasons.join('; ')}`);
  return lines.join('\n');
}

/**
 * Orchestrator. Best-effort — logs but does not throw on send failure.
 * The WA sender is injected so tests don't need the module-level WA
 * module loaded.
 */
export async function sendCartrackReconcileAlert(args: {
  report: CartrackReconcileReport;
  groupJid: string;
  mismatchThreshold: number;
  send: (groupJid: string, message: string) => Promise<void>;
  logger: { info: (msg: string) => void; error: (msg: string) => void };
}): Promise<{ alerted: boolean; reasons: string[] }> {
  const reasons = shouldAlert(args.report, {
    mismatchThreshold: args.mismatchThreshold,
  });
  if (reasons.length === 0) {
    args.logger.info(
      '[cartrack-reconcile] no WA alert — all thresholds clear'
    );
    return { alerted: false, reasons: [] };
  }
  const message = buildAlertMessage(args.report, reasons);
  try {
    await args.send(args.groupJid, message);
    args.logger.info(
      `[cartrack-reconcile] WA alert sent to ${args.groupJid} (${reasons.length} reasons)`
    );
    return { alerted: true, reasons };
  } catch (err) {
    args.logger.error(
      `[cartrack-reconcile] WA alert send failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { alerted: false, reasons };
  }
}
