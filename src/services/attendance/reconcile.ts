/**
 * Nightly attendance reconciliation.
 *
 * Orchestrates two side effects against attendance_entries + attendance_daily_summaries:
 *
 *   1. Auto-close dangling `status='open'` entries older than the configured
 *      threshold (default 16h) → `status='auto_closed'` + a `missing_clock_out`
 *      exception. Preserves the original clock_in_at; writes `clock_out_at =
 *      clock_in_at + autoCloseCapHrs` so the calculator gets a bounded
 *      duration (calculator itself refuses >24h shifts as `incomplete`).
 *
 *   2. Compute daily summaries for closed entries that don't yet have a row
 *      in attendance_daily_summaries. Summaries are upserted ON CONFLICT
 *      (staff_id, work_date) DO UPDATE so a manual correction → re-run
 *      produces the latest numbers without duplicating rows.
 *
 * Chronological contract:
 *   The calculator's weekly-cap detection only works if summaries within a
 *   payroll week are computed STRICTLY IN ORDER. This module groups pending
 *   entries per (staff, ISO-week Monday), iterates chronologically within
 *   each group, and seeds `runningWeeklyOt` from summaries persisted STRICTLY
 *   BEFORE the first recomputing date of the group. Anything recomputed in
 *   this pass (or persisted on/after the first recomputing date) is NOT
 *   counted in the seed — those values are produced in-pass in order.
 *
 * Queries live in reconcileQueries.ts; writes in reconcileWriters.ts.
 */

import { log } from '@/lib/logger';
import {
  calculateDailySummary,
  type AttendanceEntryInput,
} from './overtimeCalculator';
import { loadObservedHolidays } from './saPublicHolidays';
import {
  loadDefaultRule,
  loadOpenEntriesOlderThan,
  loadClosedEntriesMissingSummary,
  loadPersistedWeeklyOtBefore,
  type ClosedEntryRow,
} from './reconcileQueries';
import {
  autoCloseOneEntry,
  upsertSummary,
  raiseCapViolation,
} from './reconcileWriters';
import {
  computeWageCents,
  hourlyRateCentsFromDbValue,
} from './wageCalculator';

export interface ReconcileOptions {
  /** If set, only reconcile entries whose work_date is >= this ISO date. Default: last 14 days. */
  fromDate?: string;
  /** If set, only reconcile entries whose work_date is <= this ISO date. Default: today (SAST). */
  toDate?: string;
  /** Hours after which an `open` entry is auto-closed. Default 16. */
  autoCloseAfterHrs?: number;
  /**
   * Duration (hours) booked on an auto-closed entry. We don't know when the
   * staff actually left, so we book `autoCloseCapHrs` as the total so the
   * calculator (which refuses >24h) still produces a daily summary, and the
   * `missing_clock_out` exception carries the original clock_in. Default 9
   * (BCEA `dailyOrdinaryHrs` — conservative for payroll).
   */
  autoCloseCapHrs?: number;
}

export interface ReconcileReport {
  scannedFrom: string;
  scannedTo: string;
  autoClosed: number;
  summariesUpserted: number;
  summariesSkippedIncomplete: number;
  weeklyCapViolations: number;
  errorsPerEntry: Array<{ entryId: string; error: string }>;
  startedAt: string;
  finishedAt: string;
}

const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_AUTO_CLOSE_HRS = 16;
const DEFAULT_AUTO_CLOSE_CAP_HRS = 9;
const SAST_TZ = 'Africa/Johannesburg';

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Re-export so existing importers (including tests) that reach for
// `isoWeekMonday` from this module keep working. The canonical
// implementation lives in ./isoWeek.
import { isoWeekMonday } from './isoWeek';
export { isoWeekMonday };

async function runAutoClose(
  autoCloseAfterHrs: number,
  autoCloseCapHrs: number
): Promise<number> {
  const rows = await loadOpenEntriesOlderThan(autoCloseAfterHrs);
  if (rows.length === 0) return 0;
  let closed = 0;
  for (const row of rows) {
    const ok = await autoCloseOneEntry(row, autoCloseAfterHrs, autoCloseCapHrs);
    if (ok) closed += 1;
  }
  return closed;
}

export async function reconcile(options: ReconcileOptions = {}): Promise<ReconcileReport> {
  const startedAt = new Date();
  const toDate = options.toDate ?? todayInSast();
  const fromDate = options.fromDate ?? addDays(toDate, -DEFAULT_WINDOW_DAYS);
  const autoCloseAfterHrs = options.autoCloseAfterHrs ?? DEFAULT_AUTO_CLOSE_HRS;
  const autoCloseCapHrs = options.autoCloseCapHrs ?? DEFAULT_AUTO_CLOSE_CAP_HRS;

  if (fromDate > toDate) {
    throw new Error(`reconcile: fromDate (${fromDate}) > toDate (${toDate})`);
  }

  const autoClosed = await runAutoClose(autoCloseAfterHrs, autoCloseCapHrs);

  const rule = await loadDefaultRule();
  const publicHolidays = await loadObservedHolidays(fromDate, toDate);
  const pending = await loadClosedEntriesMissingSummary(fromDate, toDate);

  // Group by (staff_id, iso-week Monday) so we can thread the running
  // weeklyOvertimeHrsBefore chronologically within each week.
  const groups = new Map<string, ClosedEntryRow[]>();
  for (const row of pending) {
    const weekMon = isoWeekMonday(row.work_date);
    const key = `${row.staff_id}|${weekMon}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const report: ReconcileReport = {
    scannedFrom: fromDate,
    scannedTo: toDate,
    autoClosed,
    summariesUpserted: 0,
    summariesSkippedIncomplete: 0,
    weeklyCapViolations: 0,
    errorsPerEntry: [],
    startedAt: startedAt.toISOString(),
    finishedAt: '',
  };

  for (const [key, entries] of groups) {
    const [staffId, weekMon] = key.split('|') as [string, string];
    // Defence-in-depth chronological sort. The DB query ORDER BY already
    // delivers entries in (staff, work_date, clock_in_at) order, but we
    // re-sort in-memory so a future refactor that drops the ORDER BY or a
    // reordering group-by step cannot silently misattribute cap violations
    // to the wrong entry.
    entries.sort(
      (a, b) =>
        a.work_date.localeCompare(b.work_date) ||
        a.clock_in_at.localeCompare(b.clock_in_at)
    );
    // The first recomputing date bounds the "strictly before" seed. This
    // preserves the calculator's chronological-before contract and prevents
    // Sat/Sun OT from being credited as "before" Mon-Fri on a mid-week retro.
    const firstRecomputeDate = entries[0]!.work_date;
    let runningWeeklyOt = await loadPersistedWeeklyOtBefore(
      staffId,
      weekMon,
      firstRecomputeDate
    );

    for (const row of entries) {
      try {
        const entry: AttendanceEntryInput = {
          workDate: row.work_date,
          clockInAt: new Date(row.clock_in_at),
          clockOutAt: new Date(row.clock_out_at),
        };
        const summary = calculateDailySummary({
          entry,
          rule,
          publicHolidays,
          staffBceaApplicable: row.bcea_applicable,
          weeklyOvertimeHrsBefore: runningWeeklyOt,
        });
        if (summary.incomplete) {
          report.summariesSkippedIncomplete += 1;
          log.warn(
            '[attendance-reconcile] entry returned incomplete — skipping summary',
            { entryId: row.id, staffId, workDate: row.work_date }
          );
          continue;
        }

        // Wage snapshot. Captured at reconcile time per the Phase 1b+
        // policy; historical rate changes between clock-in and reconcile
        // favour the newer rate. Null-rate staff (salaried / not yet
        // hourly-converted) get wage_amount_cents=NULL, which the
        // migration-324 CHECK pairs with a NULL snapshot.
        const hourlyRateCents = hourlyRateCentsFromDbValue(row.hourly_rate);
        const wageAmountCents =
          hourlyRateCents !== null
            ? computeWageCents({
                summary,
                rule,
                hourlyRateCents,
                ordinarilyWorksSundays: row.ordinarily_works_sundays,
              })
            : null;

        await upsertSummary(staffId, row.work_date, summary, {
          wageAmountCents,
          hourlyRateSnapshotCents: wageAmountCents === null ? null : hourlyRateCents,
        });
        report.summariesUpserted += 1;

        // Advance the running counter AS SOON AS the summary is persisted,
        // regardless of whether the subsequent cap-violation exception
        // insert succeeds. If we advanced only after raiseCapViolation,
        // a transient DB failure on that insert would leave the counter
        // stale — subsequent days in the same week would then miss their
        // own cap detections. The persisted summary is the source of truth;
        // the exception row is bookkeeping.
        runningWeeklyOt += summary.overtimeHrs;

        if (summary.weeklyOvertimeOverCap) {
          try {
            await raiseCapViolation(row.id, runningWeeklyOt, rule.weeklyOtCapHrs);
            report.weeklyCapViolations += 1;
          } catch (capErr) {
            // Explicit: the summary IS persisted; we just failed to write
            // the audit row. Log loud, record the error, keep going. The
            // next reconcile run will NOT re-detect this because the cap
            // check is per-day in-pass, not persistent — callers must scan
            // exceptionsPerEntry and re-raise manually.
            const msg = capErr instanceof Error ? capErr.message : String(capErr);
            report.errorsPerEntry.push({
              entryId: row.id,
              error: `raiseCapViolation failed: ${msg}`,
            });
            log.error(
              '[attendance-reconcile] summary persisted but cap-violation exception failed — manual audit required',
              { entryId: row.id, staffId, workDate: row.work_date, error: msg }
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.errorsPerEntry.push({ entryId: row.id, error: message });
        log.error('[attendance-reconcile] failed to compute/upsert summary', {
          entryId: row.id,
          staffId,
          workDate: row.work_date,
          error: message,
        });
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}
