import { listCandidateRows } from './candidateRepository';
import { prepareCandidate } from './candidateService';
import { cleanupLeaseUntil, processAcknowledgementCleanup } from './acknowledgementCleanup';
import { recordOneMapConsent } from './consentService';
import {
  claimDueAcknowledgementCleanup, claimNextExport, createExport,
  saveCandidateDecision, transitionExportState, type VelocityReviewExport,
} from './exportRepository';
import {
  expireStalledHandshakes, markHandshakeTagsLeft, sweepStalledHandshakes,
} from './staleHandshakes';
import {
  HighLevelClient, loadVelocityReviewGhlConfig,
} from './ghlClient';
import { sendVelocityReviewRunSummary } from './summaryEmail';
import {
  createOrResumeRun, listCompletedRunDates, loadVelocityReviewControl, selectDueDates,
  transitionRunStatus, withVelocityReviewLock,
} from './runRepository';
import type { RunSummaryCounts } from './types';
import { processOneExport } from './contactExport';
import {
  addCounts, dryRun, finishDate, prepareDate, previousDate, sastDate,
  type DateWork, type ProcessingContext,
} from './dateWork';
import type {
  GhlOperations, ProcessorDependencies, ProcessorLimits,
  VelocityReviewDateResult, VelocityReviewRunInput, VelocityReviewRunResult,
} from './dependencies';

// Re-exported so './processor' stays the module's entry point for callers and
// tests. The implementation moved out to keep every file under the 300-line cap:
// contactExport.ts owns the per-export state machine, dateWork.ts the per-date
// discovery and roll-up, dependencies.ts the shared injection surface.
export { processOneExport } from './contactExport';
export type {
  ExportProcessResult, ProcessableExport, ProcessorDependencies, ProcessorLimits,
  VelocityReviewDateResult, VelocityReviewRunInput, VelocityReviewRunResult,
} from './dependencies';

// The scheduler wrapper allows 30 minutes. Stop starting contact work after 22 minutes,
// leaving three minutes to drain in-flight contacts and a further five-minute transport margin.
const RUN_BUDGET_MS = 25 * 60_000;
const CONTACT_DRAIN_MS = 3 * 60_000;
const MAX_CONCURRENT_EXPORTS = 4;
// A parked handshake older than this will never resolve itself; see
// expireStalledHandshakes for why leaving it pinned deadlocks the whole export.
const HANDSHAKE_STALE_MS = 24 * 60 * 60_000;

type ClaimedWork = { kind: 'export' | 'cleanup'; row: VelocityReviewExport };

function effectiveLimits(deps: ProcessorDependencies): ProcessorLimits {
  const supplied = deps.limits;
  const runBudgetMs = Math.max(1, supplied?.runBudgetMs ?? RUN_BUDGET_MS);
  return {
    runBudgetMs,
    contactDrainMs: Math.min(runBudgetMs, Math.max(0, supplied?.contactDrainMs ?? CONTACT_DRAIN_MS)),
  };
}

async function claimOneWork(deps: ProcessorDependencies,
  eligibleIds: readonly string[]): Promise<ClaimedWork | null> {
  const claimed = await deps.exports.claimNextExport(deps.now(), eligibleIds);
  if (claimed) return { kind: 'export', row: claimed };
  const cleanupNow = deps.now();
  const cleanup = await deps.exports.claimDueAcknowledgementCleanup(
    cleanupNow, eligibleIds, cleanupLeaseUntil(cleanupNow));
  return cleanup ? { kind: 'cleanup', row: cleanup } : null;
}

async function processClaimedWork(claimed: ClaimedWork, contexts: Map<string, ProcessingContext>,
  deps: ProcessorDependencies): Promise<void> {
  const item = contexts.get(claimed.row.id);
  if (!item) throw new Error('Claimed Velocity review export lacks current candidate evidence');
  let outcome;
  if (claimed.kind === 'cleanup') {
    outcome = await processAcknowledgementCleanup(claimed.row, deps);
  } else {
    outcome = await processOneExport({ ...item, export: claimed.row }, deps);
    item.contactUpserted ||= outcome.contactUpserted;
  }
  item.processed = true;
  item.export = { ...item.export, state: outcome.state, errorCode: outcome.errorCode,
    nextAttemptAt: outcome.nextAttemptAt };
}

function nextRetryWake(contexts: Map<string, ProcessingContext>, now: number): number | undefined {
  return [...contexts.values()].flatMap((item) =>
    (item.export.state === 'retryable_failure' || item.export.state === 'ack_cleanup_pending')
      && item.export.nextAttemptAt && item.export.nextAttemptAt.getTime() > now
      ? [item.export.nextAttemptAt.getTime()] : [])
    .sort((left, right) => left - right)[0];
}

function markDeadlineDeferred(contexts: Map<string, ProcessingContext>,
  deferredIds: Set<string>): void {
  for (const item of contexts.values()) {
    const scheduledRetry = (item.export.state === 'retryable_failure'
      || item.export.state === 'ack_cleanup_pending') && item.export.nextAttemptAt !== null;
    if (item.export.state === 'ready' || scheduledRetry) deferredIds.add(item.export.id);
  }
}

async function lockedRun(deps: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const limits = effectiveLimits(deps);
  const runDeadline = deps.now().getTime() + limits.runBudgetMs;
  const claimCutoff = runDeadline - limits.contactDrainMs;
  const control = await deps.runs.loadVelocityReviewControl();
  if (!control.automationEnabled && !control.pilotEnabled) return { status: 'disabled', counts: {}, dates: [] };
  // Maintenance, not date work, so it runs before any early return: a parked
  // handshake pins its date at `partial`, and it also holds the one-phone-inflight
  // index against its number. A blocked run is exactly when both keep accruing, so
  // skipping the sweep there is the one case where it is most needed.
  //
  // This does not un-block a run. `gap_older_than_7_days` is keyed on
  // velocity_review_runs.status, which only a processed date can change, so clearing
  // export rows cannot lift it — and should not. The guard exists to stop a long
  // outage messaging customers about installs from weeks ago; lifting it is a human
  // decision, which is why the cron summary now names the reason.
  const sweepNow = deps.now();
  await sweepStalledHandshakes(
    new Date(sweepNow.getTime() - HANDSHAKE_STALE_MS), sweepNow, deps);
  const completed = await deps.runs.listCompletedRunDates();
  const due = selectDueDates(control, completed, previousDate(sastDate(deps.now())));
  if (due.status === 'disabled') return { status: 'disabled', counts: {}, dates: [] };
  if (due.status === 'blocked') {
    const blocked = { status: 'blocked' as const, reason: due.reason, counts: {}, dates: [] };
    await deps.summary.send(blocked); return blocked;
  }
  const contexts = new Map<string, ProcessingContext>(); const work: DateWork[] = [];
  for (const date of due.dates) {
    work.push(await prepareDate(date, due.status === 'pilot' ? due.limit : null, deps, contexts));
  }
  const eligibleIds = [...contexts.keys()];
  const deadlineDeferredIds = new Set<string>();
  for (;;) {
    if (deps.now().getTime() >= claimCutoff) {
      markDeadlineDeferred(contexts, deadlineDeferredIds);
      break;
    }
    const claimResults = await Promise.allSettled(Array.from({ length: MAX_CONCURRENT_EXPORTS },
      () => claimOneWork(deps, eligibleIds)));
    const claimFailure = claimResults.find((item): item is PromiseRejectedResult => item.status === 'rejected');
    const claimed = claimResults.flatMap((item) =>
      item.status === 'fulfilled' && item.value ? [item.value] : []);
    const unique = claimed.filter((item, index) =>
      claimed.findIndex((other) => other.row.id === item.row.id) === index);
    if (unique.length > 0) {
      const processingResults = await Promise.allSettled(
        unique.map((item) => processClaimedWork(item, contexts, deps)));
      const processingFailure = processingResults.find(
        (item): item is PromiseRejectedResult => item.status === 'rejected');
      if (claimFailure) throw claimFailure.reason;
      if (processingFailure) throw processingFailure.reason;
      continue;
    }
    if (claimFailure) throw claimFailure.reason;
    const now = deps.now().getTime();
    const wakeAt = nextRetryWake(contexts, now);
    if (wakeAt === undefined) break;
    if (wakeAt > claimCutoff) {
      markDeadlineDeferred(contexts, deadlineDeferredIds);
      break;
    }
    await deps.sleep(wakeAt - now);
    if (deps.now().getTime() < wakeAt) {
      markDeadlineDeferred(contexts, deadlineDeferredIds);
      break;
    }
  }
  const dates: VelocityReviewDateResult[] = []; const counts: RunSummaryCounts = {};
  for (const item of work) { const date = await finishDate(item, contexts, deadlineDeferredIds, deps);
    dates.push(date); addCounts(counts, date.counts); }
  const status = due.status === 'pilot' ? 'pilot' : dates.some((item) => item.status === 'partial') ? 'partial' : 'complete';
  const output: VelocityReviewRunResult = { status, counts, dates };
  await deps.summary.send(output); return output;
}

function defaultDependencies(dry: boolean): ProcessorDependencies {
  const config = dry ? null : loadVelocityReviewGhlConfig(process.env);
  const secret = config?.phoneHmacSecret ?? process.env.VELOCITY_REVIEW_PHONE_HMAC_SECRET?.trim() ?? 'dry-run-only';
  const unavailable: GhlOperations = { upsertContact: async () => { throw new Error('GHL unavailable in dry-run'); },
    getContact: async () => { throw new Error('GHL unavailable in dry-run'); }, addTags: async () => undefined,
    removeTags: async () => undefined };
  return { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    exportKeyFieldId: config?.fieldExportKeyId ?? '',
    candidates: { listCandidateRows, prepareCandidate: (row) => prepareCandidate(row, secret) },
    consent: { recordOneMapConsent }, ghl: config ? new HighLevelClient(config) : unavailable,
    exports: { saveCandidateDecision, createExport, claimNextExport,
      claimDueAcknowledgementCleanup, expireStalledHandshakes, markHandshakeTagsLeft,
      transitionExportState },
    runs: { withVelocityReviewLock, loadVelocityReviewControl, listCompletedRunDates,
      createOrResumeRun, transitionRunStatus }, summary: { send: sendVelocityReviewRunSummary } };
}
export async function runVelocityReviewExport(input: VelocityReviewRunInput = {},
  supplied?: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const deps = supplied ?? defaultDependencies(input.dryRun === true);
  if (input.dryRun) return dryRun(input, deps);
  const locked = await deps.runs.withVelocityReviewLock(() => lockedRun(deps));
  return locked.acquired && locked.value ? locked.value : { status: 'busy', counts: {}, dates: [] };
}
