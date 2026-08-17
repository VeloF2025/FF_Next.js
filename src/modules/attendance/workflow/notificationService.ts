import { randomUUID } from 'crypto';
import { notify } from '@/modules/notifications/services/notificationBus';
import type { NotifyResult } from '@/modules/notifications/types';
import type { NotifyPayload } from '@/modules/notifications/types';
import { getPeriodReadiness } from './periodQueries';
import {
  claimDispatch, finishDispatch, loadAdminRecipients, loadClockoutCandidates,
  loadMorningCandidates, loadStaffUser, loadSupervisorDigestCounts, loadSupervisorLinks,
  loadSupervisorMorningFlagCount,
  type StaffUserRow,
} from './notificationQueries';

export const ATTENDANCE_NOTIFICATION_PHASES = ['morning', 'clockout', 'digest', 'weekly'] as const;
export type AttendanceNotificationPhase = typeof ATTENDANCE_NOTIFICATION_PHASES[number];
export type AttendanceNotificationFailureReason =
  | 'recipient_missing' | 'recipient_ambiguous' | 'recipient_inactive'
  | 'recipient_resolution_failed' | 'candidate_query_failed'
  | 'notification_bus_invocation_failed' | 'notification_bus_delivery_failed' | 'dispatch_multi_recipient'
  | 'dispatch_claim_failed'
  | 'dispatch_status_update_failed';

export interface AttendanceNotificationFailure {
  sourceKey: string;
  reason: AttendanceNotificationFailureReason;
}

export interface AttendanceNotificationReport {
  runId: string;
  phase: AttendanceNotificationPhase;
  examined: number;
  claimed: number;
  accepted: number;
  failed: number;
  skipped: number;
  failures: AttendanceNotificationFailure[];
}

interface RunArgs { phase: AttendanceNotificationPhase; now: Date }
interface SastContext { workDate: string; day: number; minute: number; weekMonday: string }
interface Candidate {
  recipientUserId: string;
  deliveryKey: string;
  sourceKey: string;
  payload: NotifyPayload;
}

const FAILURE_LIMIT = 20;

export async function runAttendanceNotifications(args: RunArgs): Promise<AttendanceNotificationReport> {
  assertPhase(args.phase);
  const context = sastContext(args.now);
  const report = emptyReport(args.phase, args.now);
  if (!phaseIsDue(args.phase, context)) return report;

  if (args.phase === 'morning') {
    const rows = await loadMorningCandidates(context.workDate);
    report.examined = rows.length;
    for (const row of rows) {
      const sourceKey = `exception:${row.exception_id}:v${row.result_version}`;
      const recipient = await resolveWorkerRecipient(row.staff_id, sourceKey, report);
      if (!recipient) continue;
      await dispatch({
        recipientUserId: recipient,
        deliveryKey: `attendance:correction:${recipient}:${row.work_date}:${row.exception_id}:v${row.result_version}`,
        sourceKey,
        payload: {
          event_type: 'attendance.correction_required', title: 'Attendance correction required',
          body: `Correct your ${row.kind.replace(/_/g, ' ')} for ${row.work_date}.`,
          action_url: `/my/attendance/corrections/new?exception_id=${encodeURIComponent(row.exception_id)}`,
          source_module: 'attendance', source_id: row.exception_id,
          recipient_user_ids: [recipient],
        },
      }, args.phase, report);
    }
    await runSupervisorMorning(context, report);
    return report;
  }

  if (args.phase === 'clockout') {
    const rows = await loadClockoutCandidates(context.workDate);
    report.examined = rows.length;
    for (const row of rows) {
      const sourceKey = `entry:${row.entry_id}`;
      const recipient = await resolveWorkerRecipient(row.staff_id, sourceKey, report);
      if (!recipient) continue;
      await dispatch({
        recipientUserId: recipient,
        deliveryKey: `attendance:clockout:${recipient}:${row.work_date}`,
        sourceKey,
        payload: {
          event_type: 'attendance.clockout_due', title: 'Clock out required',
          body: `Your ${row.work_date} attendance session is still open.`,
          action_url: '/my/attendance', source_module: 'attendance', source_id: row.entry_id,
          recipient_user_ids: [recipient],
        },
      }, args.phase, report);
    }
    return report;
  }

  if (args.phase === 'digest') {
    await runSupervisorDigest(context, report);
    return report;
  }

  await runWeeklyReadiness(context, report);
  return report;
}

async function runSupervisorDigest(context: SastContext, report: AttendanceNotificationReport): Promise<void> {
  const groups = await supervisorGroups();
  report.examined += groups.size;
  for (const [recipient, links] of groups) {
    const sourceKey = `supervisor:${recipient}:${context.workDate}`;
    if (links.length !== 1 || !links[0]) {
      addFailure(report, sourceKey, links.length > 1 ? 'recipient_ambiguous' : 'recipient_missing');
      continue;
    }
    let counts: Awaited<ReturnType<typeof loadSupervisorDigestCounts>>;
    try { counts = await loadSupervisorDigestCounts(links[0], context.workDate); }
    catch { addFailure(report, sourceKey, 'candidate_query_failed'); continue; }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (total === 0) { report.skipped += 1; continue; }
    const countLabel = total > 999 ? '999+' : String(total);
    await dispatch({
      recipientUserId: recipient, deliveryKey: `attendance:digest:${recipient}:${context.workDate}`,
      sourceKey,
      payload: {
        event_type: 'attendance.supervisor_digest', title: 'Attendance actions need review',
        body: `${countLabel} scoped attendance action${total === 1 ? '' : 's'}: ` +
          `${counts.liveOpenSessions} live open, ${counts.sundayWork} Sunday, ${counts.overtime} overtime, ` +
          `${counts.unresolvedClassifications} classification, ${counts.outstandingCorrections} correction.`,
        action_url: '/staff/attendance/corrections?status=unresolved', source_module: 'attendance',
        metadata: { workDate: context.workDate, actionCount: Math.min(total, 999), hasMore: total > 999,
          ...counts },
        recipient_user_ids: [recipient],
      },
    }, 'digest', report);
  }
}

async function runSupervisorMorning(
  context: SastContext,
  report: AttendanceNotificationReport,
): Promise<void> {
  const groups = await supervisorGroups();
  report.examined += groups.size;
  for (const [recipient, links] of groups) {
    const sourceKey = `supervisor:${recipient}:${context.workDate}`;
    if (links.length !== 1 || !links[0]) {
      addFailure(report, sourceKey, links.length > 1 ? 'recipient_ambiguous' : 'recipient_missing');
      continue;
    }
    let total: number;
    try { total = await loadSupervisorMorningFlagCount(links[0], context.workDate); }
    catch { addFailure(report, sourceKey, 'candidate_query_failed'); continue; }
    if (total === 0) { report.skipped += 1; continue; }
    await dispatch({
      recipientUserId: recipient,
      deliveryKey: `attendance:morning-supervisor:${recipient}:${context.workDate}`,
      sourceKey,
      payload: {
        event_type: 'attendance.supervisor_morning_flags', title: 'Morning attendance flags',
        body: `${total > 999 ? '999+' : total} late/no-clock flag${total === 1 ? '' : 's'} need review.`,
        action_url: '/staff/attendance/corrections?status=unresolved', source_module: 'attendance',
        metadata: { workDate: context.workDate, flagCount: Math.min(total, 999), hasMore: total > 999 },
        recipient_user_ids: [recipient],
      },
    }, 'morning', report);
  }
}

async function supervisorGroups(): Promise<Map<string, (string | null)[]>> {
  const groups = new Map<string, (string | null)[]>();
  for (const row of await loadSupervisorLinks()) {
    const links = groups.get(row.recipient_user_id) ?? [];
    links.push(row.supervisor_staff_id);
    groups.set(row.recipient_user_id, links);
  }
  return groups;
}

async function runWeeklyReadiness(context: SastContext, report: AttendanceNotificationReport): Promise<void> {
  const readiness = await getPeriodReadiness(context.weekMonday);
  const recipients = await loadAdminRecipients();
  report.examined = recipients.length;
  for (const row of recipients) {
    const recipient = row.recipient_user_id;
    const state = readiness.readyToLock ? 'ready to lock' : `${readiness.blockerCount} blockers remain`;
    await dispatch({
      recipientUserId: recipient, deliveryKey: `attendance:weekly:${recipient}:${context.weekMonday}`,
      sourceKey: `week:${context.weekMonday}`,
      payload: {
        event_type: 'attendance.hr_readiness', title: 'Weekly attendance readiness',
        body: `${readiness.approvedDayCount} of ${readiness.expectedDayCount} expected days approved; ${state}.`,
        action_url: `/staff/attendance/locks?week=${context.weekMonday}`, source_module: 'attendance',
        metadata: { weekStartDate: context.weekMonday, readyToLock: readiness.readyToLock,
          blockerCount: readiness.blockerCount, reconciliationFresh: readiness.reconciliationFresh },
        recipient_user_ids: [recipient],
      },
    }, 'weekly', report);
  }
}

async function resolveWorkerRecipient(
  staffId: string, sourceKey: string, report: AttendanceNotificationReport,
): Promise<string | null> {
  let rows: StaffUserRow[];
  try { rows = await loadStaffUser(staffId); }
  catch { addFailure(report, sourceKey, 'recipient_resolution_failed'); return null; }
  if (rows.length === 0 || !rows[0]?.id) { addFailure(report, sourceKey, 'recipient_missing'); return null; }
  if (rows.length !== 1) { addFailure(report, sourceKey, 'recipient_ambiguous'); return null; }
  if (!activeLink(rows[0])) { addFailure(report, sourceKey, 'recipient_inactive'); return null; }
  return rows[0].id;
}

function activeLink(row: StaffUserRow): boolean {
  return row.is_active === true && row.staff_is_active !== false && row.end_date === null;
}

async function dispatch(candidate: Candidate, phase: AttendanceNotificationPhase,
  report: AttendanceNotificationReport): Promise<void> {
  // One recipient per delivery key is an invariant the retry logic depends on,
  // not a coincidence of the current callers. `failed > 0` fails the whole
  // dispatch, and the next run re-sends the whole payload — with several
  // recipients under one key, a partial failure would re-notify the ones that
  // already succeeded, and user_notifications has no uniqueness guard to
  // deduplicate them. Every call site passes a single-element array today, so
  // this branch is unreachable and therefore untested — it exists to fail
  // loudly rather than silently duplicate if that ever changes.
  if (candidate.payload.recipient_user_ids.length !== 1) {
    addFailure(report, candidate.sourceKey, 'dispatch_multi_recipient');
    return;
  }
  try {
    if (!await claimDispatch({ deliveryKey: candidate.deliveryKey, phase,
      sourceKey: candidate.sourceKey, recipientUserId: candidate.recipientUserId })) {
      report.skipped += 1; return;
    }
    report.claimed += 1;
  } catch {
    addFailure(report, candidate.sourceKey, 'dispatch_claim_failed'); return;
  }
  // Await the bus and inspect the result. This used to fire-and-forget and then
  // swallow the rejection (`void invocation.catch(() => undefined)`) before
  // marking the dispatch `accepted`. Combined with notify() never throwing, no
  // delivery failure could ever be delivered: a run against an unreachable
  // database reported accepted=16 with zero notifications sent, and those
  // idempotency keys would have stopped a later, working run from retrying
  // them (#2506).
  let result: NotifyResult;
  try { result = await notify(candidate.payload); }
  catch {
    await markFailed(candidate.deliveryKey, 'notification_bus_invocation_failed');
    addFailure(report, candidate.sourceKey, 'notification_bus_invocation_failed');
    return;
  }
  if (result.failed > 0) {
    // Branch on `failed`, not on a delivered count. A recipient with in-app
    // disabled but WhatsApp enabled records nothing yet may well be reached, so
    // treating "nothing delivered" as failure would retry a working send forever.
    // `failed` means the bus could not act at all — the database-outage case.
    // claimDispatch can re-claim a 'failed' row, so this genuinely retries.
    await markFailed(candidate.deliveryKey, 'notification_bus_delivery_failed');
    addFailure(report, candidate.sourceKey, 'notification_bus_delivery_failed');
    return;
  }
  try {
    await finishDispatch(candidate.deliveryKey, 'accepted', null);
    report.accepted += 1;
  } catch {
    addFailure(report, candidate.sourceKey, 'dispatch_status_update_failed');
  }
}

async function markFailed(deliveryKey: string, failure: string): Promise<void> {
  try { await finishDispatch(deliveryKey, 'failed', failure); } catch { return; }
}

function addFailure(report: AttendanceNotificationReport, sourceKey: string,
  reason: AttendanceNotificationFailureReason): void {
  report.failed += 1;
  if (report.failures.length < FAILURE_LIMIT) report.failures.push({ sourceKey, reason });
}

function emptyReport(phase: AttendanceNotificationPhase, now: Date): AttendanceNotificationReport {
  return { runId: `${phase}:${now.toISOString()}:${randomUUID()}`, phase,
    examined: 0, claimed: 0, accepted: 0, failed: 0, skipped: 0, failures: [] };
}

function assertPhase(phase: string): asserts phase is AttendanceNotificationPhase {
  if (!ATTENDANCE_NOTIFICATION_PHASES.includes(phase as AttendanceNotificationPhase)) {
    throw new Error(`Unsupported attendance notification phase: ${phase}`);
  }
}

function phaseIsDue(phase: AttendanceNotificationPhase, context: SastContext): boolean {
  if (phase === 'morning') return context.day >= 1 && context.day <= 6 && context.minute >= 8 * 60 + 15;
  if (phase !== 'clockout') return true;
  if (context.day >= 1 && context.day <= 5) return context.minute >= 17 * 60;
  return context.day === 6 && context.minute >= 13 * 60;
}

function sastContext(now: Date): SastContext {
  if (Number.isNaN(now.getTime())) throw new Error('Attendance notification now must be a valid date');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const workDate = `${part('year')}-${part('month')}-${part('day')}`;
  const date = new Date(`${workDate}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return { workDate, day, minute: Number(part('hour')) * 60 + Number(part('minute')),
    weekMonday: date.toISOString().slice(0, 10) };
}
