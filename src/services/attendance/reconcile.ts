import { randomUUID } from 'crypto';
import { log } from '@/lib/logger';
import { calculateDailySummary } from './overtimeCalculator';
import type { OvertimeRuleInput } from './overtimeCalculator';
import { calculateDailyResult } from './policy/calculateDailyResult';
import { persistCalculatedDay } from './policy/projectionRepository';
import type { AttendanceSchedulePolicy, CalculatedDailyResult } from './policy/types';
import {
  findEffectivePolicy,
  loadDefaultRule,
  loadEffectivePolicy,
  loadExpectedAttendanceDays,
  loadOpenEntriesForReconciliation,
  loadPersistedWeeklyOtBefore,
  loadReconciliationEntries,
  policyCoversAnyDayInRange,
} from './reconcileQueries';
import {
  finishReconciliationRun,
  startReconciliationRun,
  systemCloseEntry,
  upsertSummary,
} from './reconcileWriters';
import { countsFrom, emptyReport, runStatus, type ReconcileReport } from './reconcileReport';
import { loadObservedHolidays } from './saPublicHolidays';
import { computeWageCents, hourlyRateCentsFromDbValue } from './wageCalculator';
import { isoWeekMonday } from './isoWeek';
import {
  buildCandidates,
  dayKey,
  evidenceFor,
  type DayCandidate,
} from './reconcileCandidates';
export { isoWeekMonday };
export interface ReconcileOptions { fromDate?: string; toDate?: string }
export type { ReconcileReport } from './reconcileReport';
interface LegacyContext {
  rule: OvertimeRuleInput;
  publicHolidays: Set<string>;
  weeklyOvertime: Map<string, number>;
}
const DEFAULT_WINDOW_DAYS = 14;
const SAST_TZ = 'Africa/Johannesburg';
export async function reconcile(options: ReconcileOptions = {}): Promise<ReconcileReport> {
  const startedAt = new Date();
  const defaultTo = addDays(todayInSast(), -1);
  const requestedTo = options.toDate ?? defaultTo;
  const toDate = requestedTo > defaultTo ? defaultTo : requestedTo;
  const fromDate = options.fromDate ?? addDays(toDate, -(DEFAULT_WINDOW_DAYS - 1));
  if (fromDate > defaultTo) {
    throw new Error(`reconcile: fromDate (${fromDate}) must not be current or future in SAST`);
  }
  if (fromDate > toDate) throw new Error(`reconcile: fromDate (${fromDate}) > toDate (${toDate})`);

  const runId = `attendance-reconcile:${startedAt.toISOString()}:${randomUUID()}`;
  const report = emptyReport(fromDate, toDate, startedAt.toISOString());
  await startReconciliationRun({ runId, scannedFrom: fromDate, scannedTo: toDate, startedAt: report.startedAt });
  const policyIds = new Set<string>();
  const failed = new Set<string>();
  const skippedLocked = new Set<string>();
  const pendingClosed = new Set<string>();
  try {
    const [primaryPolicy, openEntries, expectedDays, rule, publicHolidays] = await Promise.all([
      findEffectivePolicy(toDate),
      loadOpenEntriesForReconciliation(fromDate, toDate),
      loadExpectedAttendanceDays(fromDate, toDate),
      loadDefaultRule(),
      loadObservedHolidays(fromDate, toDate),
    ]);
    // Seeding the cache from toDate is an optimisation, not a precondition:
    // every loader above already excludes dates no policy covers, and
    // policyForDate resolves the rest lazily. An uncovered toDate must not
    // abort a window whose earlier days are covered, nor a retro --from/--to
    // run over a range that predates the first policy.
    const policyCache = new Map<string, AttendanceSchedulePolicy>();
    if (primaryPolicy) {
      policyIds.add(primaryPolicy.id);
      policyCache.set(toDate, primaryPolicy);
    } else if (await policyCoversAnyDayInRange(fromDate, toDate)) {
      log.warn('[attendance-reconcile] no effective schedule policy for the window end', {
        toDate, fromDate,
      });
    } else {
      // Nothing in the window is covered, so every loader returned empty and
      // the run would otherwise report a zero-count success. The cron only
      // inspects failedDayKeys and always exits 0, and nothing reads
      // attendance_reconciliation_runs.error_message, so a succeeded status
      // here would make a policy misconfiguration that halts all projection
      // completely silent. Fail loudly instead — the catch below records the
      // run as failed and the cron exits non-zero.
      throw new Error(`No attendance schedule policy covers ${fromDate}..${toDate}`);
    }
    for (const row of openEntries) {
      const key = dayKey(row.staff_id, row.work_date);
      try {
        const policy = await policyForDate(row.work_date, policyCache);
        policyIds.add(policy.id);
        const result = calculateDailyResult({
          policy,
          evidence: {
            workDate: row.work_date,
            clockInAt: new Date(row.clock_in_at),
            clockOutAt: null,
            clockOutSource: 'system',
          },
          isPublicHoliday: publicHolidays.has(row.work_date),
        });
        if (await systemCloseEntry(row, policy.id, result)) {
          report.systemClosed += 1;
          pendingClosed.add(key);
        }
      } catch (error) {
        if (isPeriodLockedError(error)) recordLockedSkip(skippedLocked, key, 'system closure');
        else { failed.add(key); logDayFailure(key, 'system closure', error); }
      }
    }
    const entries = await loadReconciliationEntries(fromDate, toDate);
    const { candidates, duplicateKeys } = buildCandidates(expectedDays, entries, publicHolidays);
    for (const key of duplicateKeys) {
      failed.add(key);
      log.error('[attendance-reconcile] multiple entries cannot be projected as one policy day', { dayKey: key });
    }
    const legacy: LegacyContext = { rule, publicHolidays, weeklyOvertime: new Map() };
    for (const candidate of candidates) {
      const key = dayKey(candidate.staffId, candidate.workDate);
      if (failed.has(key)) continue;
      try {
        const policy = await policyForDate(candidate.workDate, policyCache);
        policyIds.add(policy.id);
        await reconcileDay(candidate, policy, legacy, report);
        skippedLocked.delete(key);
        pendingClosed.delete(key);
      } catch (error) {
        if (isPeriodLockedError(error)) {
          recordLockedSkip(skippedLocked, key, 'day projection');
          pendingClosed.delete(key);
        } else {
          failed.add(key);
          logDayFailure(key, 'day projection', error);
        }
        legacy.weeklyOvertime.delete(`${candidate.staffId}:${isoWeekMonday(candidate.workDate)}`);
      }
    }
    report.skippedLockedDays = skippedLocked.size;
    report.failedDayKeys = [...new Set([...failed, ...pendingClosed])].sort();
  } catch (error) {
    report.skippedLockedDays = skippedLocked.size;
    report.failedDayKeys = [...new Set([...failed, ...pendingClosed])].sort();
    report.finishedAt = new Date().toISOString();
    await finishReconciliationRun({
      runId,
      schedulePolicyId: onePolicyId(policyIds),
      status: 'failed',
      counts: countsFrom(report),
      failedDayKeys: report.failedDayKeys,
      errorMessage: errorMessage(error),
      finishedAt: report.finishedAt,
    });
    throw error;
  }
  report.finishedAt = new Date().toISOString();
  await finishReconciliationRun({
    runId,
    schedulePolicyId: onePolicyId(policyIds),
    status: runStatus(report),
    counts: countsFrom(report),
    failedDayKeys: report.failedDayKeys,
    finishedAt: report.finishedAt,
  });
  return report;
}
async function reconcileDay(
  day: DayCandidate,
  policy: AttendanceSchedulePolicy,
  legacy: LegacyContext,
  report: ReconcileReport,
): Promise<void> {
  const result = calculateDailyResult({
    policy,
    evidence: evidenceFor(day),
    isPublicHoliday: day.isPublicHoliday,
  });
  const persisted = await persistCalculatedDay({
    staffId: day.staffId,
    entryId: day.entry?.id ?? null,
    policyId: policy.id,
    result,
  });
  assertPersistenceReadback(result, persisted);
  await persistLegacyShadow(day, legacy, result);

  if (day.calculationFingerprint === result.calculationFingerprint && day.resultVersion !== null) {
    report.unchangedDays += 1;
  } else {
    report.projectedDays += 1;
  }
  if (result.exceptionKinds.includes('missing_clock_out')) report.missingClockOutExceptions += 1;
  if (result.exceptionKinds.includes('missing_clock_in')) report.missingClockInExceptions += 1;
}
async function persistLegacyShadow(
  day: DayCandidate,
  context: LegacyContext,
  result: CalculatedDailyResult,
): Promise<void> {
  const row = day.entry;
  if (!row?.clock_out_at || result.exceptionKinds.includes('evidence_unreliable')) return;
  // This path writes regular_hrs / overtime_hrs / wage_amount_cents straight
  // from row.clock_out_at, bypassing calculateDailyResult entirely. On an
  // auto-closed entry that timestamp is a system closure, not a departure —
  // feeding it here is how pre-#2351 runs put fabricated hours into
  // attendance_daily_summaries. The projection columns carry the honest
  // reading for these days.
  if (row.status === 'auto_closed') return;
  const week = isoWeekMonday(row.work_date);
  const weeklyKey = `${row.staff_id}:${week}`;
  let running = context.weeklyOvertime.get(weeklyKey);
  if (running === undefined) {
    running = await loadPersistedWeeklyOtBefore(row.staff_id, week, row.work_date);
  }
  const summary = calculateDailySummary({
    entry: { workDate: row.work_date, clockInAt: new Date(row.clock_in_at), clockOutAt: new Date(row.clock_out_at) },
    rule: context.rule,
    publicHolidays: context.publicHolidays,
    staffBceaApplicable: row.bcea_applicable,
    weeklyOvertimeHrsBefore: running,
  });
  if (summary.incomplete) return;
  const hourlyRateCents = hourlyRateCentsFromDbValue(row.hourly_rate);
  const wageAmountCents = hourlyRateCents === null ? null : computeWageCents({
    summary,
    rule: context.rule,
    hourlyRateCents,
    ordinarilyWorksSundays: row.ordinarily_works_sundays,
  });
  await upsertSummary(row.staff_id, row.work_date, summary, {
    wageAmountCents,
    hourlyRateSnapshotCents: wageAmountCents === null ? null : hourlyRateCents,
  });
  context.weeklyOvertime.set(weeklyKey, running + summary.overtimeHrs);
}
async function policyForDate(
  workDate: string,
  cache: Map<string, AttendanceSchedulePolicy>,
): Promise<AttendanceSchedulePolicy> {
  const cached = cache.get(workDate);
  if (cached) return cached;
  const policy = await loadEffectivePolicy(workDate);
  cache.set(workDate, policy);
  return policy;
}
function assertPersistenceReadback(
  result: CalculatedDailyResult,
  persisted: { resultVersion: number; exceptionIds: string[] },
): void {
  if (!Number.isInteger(persisted.resultVersion) || persisted.resultVersion < 1) {
    throw new Error('Daily projection did not return a valid result version');
  }
  const expectedExceptions = new Set(result.exceptionKinds).size;
  if (persisted.exceptionIds.length !== expectedExceptions) {
    throw new Error(`Daily projection read back ${persisted.exceptionIds.length}/${expectedExceptions} exceptions`);
  }
}
function onePolicyId(ids: Set<string>): string | null {
  return ids.size === 1 ? [...ids][0]! : null;
}
function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}
function logDayFailure(key: string, operation: string, error: unknown): void {
  log.error(`[attendance-reconcile] ${operation} failed`, { dayKey: key, error: errorMessage(error) });
}
function isPeriodLockedError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'period_locked';
}
function recordLockedSkip(skipped: Set<string>, key: string, operation: string): void {
  skipped.add(key);
  log.info('[attendance-reconcile] locked day skipped', { dayKey: key, operation });
}
function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAST_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
