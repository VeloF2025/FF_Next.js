import { listCandidateRows } from './candidateRepository';
import { prepareCandidate } from './candidateService';
import { cleanupLeaseUntil, processAcknowledgementCleanup } from './acknowledgementCleanup';
import { recordOneMapConsent, type OneMapConsentInput } from './consentService';
import {
  claimDueAcknowledgementCleanup, claimNextExport, createExport, saveCandidateDecision, transitionExportState,
  type ExportTransitionUpdates, type VelocityReviewExport,
} from './exportRepository';
import {
  HighLevelClient, HighLevelRequestError, loadVelocityReviewGhlConfig,
  type HighLevelContact, type VelocityReviewContactInput,
} from './ghlClient';
import { normalizeSaMobileMsisdn, toE164 } from './phone';
import { nextRetryAt } from './retry';
import { sendVelocityReviewRunSummary } from './summaryEmail';
import {
  createOrResumeRun, listCompletedRunDates, loadVelocityReviewControl, selectDueDates,
  transitionRunStatus, withVelocityReviewLock, type VelocityReviewControl,
  type VelocityReviewRun, type VelocityReviewRunStatus,
} from './runRepository';
import {
  CANDIDATE_SOURCES, QUARANTINE_REASONS,
  type CandidateDbRow, type CandidateDecision, type ExportState,
  type PreparedCandidate, type RunSummaryCounts,
} from './types';
const READY_TAG = 'velocity-review-ready';
const ENROLLED_TAG = 'velocity-review-enrolled';
const POLL_INTERVAL_MS = 5_000;
const POLL_LIMIT_MS = 30_000;
// The scheduler wrapper allows 30 minutes. Stop starting contact work after 22 minutes,
// leaving three minutes to drain in-flight contacts and a further five-minute transport margin.
const RUN_BUDGET_MS = 25 * 60_000;
const CONTACT_DRAIN_MS = 3 * 60_000;
const MAX_CONCURRENT_EXPORTS = 4;
interface GhlOperations {
  upsertContact(input: VelocityReviewContactInput): Promise<HighLevelContact>;
  getContact(contactId: string): Promise<HighLevelContact>;
  addTags(contactId: string, tags: readonly string[]): Promise<void>;
  removeTags(contactId: string, tags: readonly string[]): Promise<void>;
}
export interface ProcessableExport { export: VelocityReviewExport; candidate: PreparedCandidate }
export interface ExportProcessResult {
  exportId: string; state: ExportState; errorCode: string | null;
  nextAttemptAt: Date | null; workflowAcknowledged: boolean; contactUpserted: boolean;
}
export interface VelocityReviewRunInput { dryRun?: boolean; targetDate?: string }
export interface VelocityReviewDateResult { targetDate: string; status: VelocityReviewRunStatus; counts: RunSummaryCounts }
export interface VelocityReviewRunResult {
  status: 'disabled' | 'busy' | 'dry_run' | 'blocked' | 'complete' | 'partial' | 'pilot';
  counts: RunSummaryCounts; dates: VelocityReviewDateResult[]; reason?: string;
}
export interface ProcessorLimits {
  runBudgetMs: number;
  contactDrainMs: number;
}
export interface ProcessorDependencies {
  now(): Date;
  sleep(ms: number): Promise<void>;
  exportKeyFieldId: string;
  candidates: {
    listCandidateRows(targetDate: string): Promise<CandidateDbRow[]>;
    prepareCandidate(row: CandidateDbRow): CandidateDecision;
  };
  consent: { recordOneMapConsent(input: OneMapConsentInput): Promise<'granted' | 'withdrawn'> };
  ghl: GhlOperations;
  exports: {
    saveCandidateDecision(run: VelocityReviewRun, decision: CandidateDecision): Promise<void>;
    createExport(run: VelocityReviewRun, candidate: PreparedCandidate): Promise<{ created: boolean; export: VelocityReviewExport }>;
    claimNextExport(now: Date, eligibleExportIds: readonly string[]): Promise<VelocityReviewExport | null>;
    claimDueAcknowledgementCleanup(now: Date, eligibleExportIds: readonly string[],
      leaseUntil: Date): Promise<VelocityReviewExport | null>;
    transitionExportState(id: string, expected: ExportState, next: ExportState,
      updates?: ExportTransitionUpdates): Promise<VelocityReviewExport | null>;
  };
  runs: {
    withVelocityReviewLock<T>(work: () => Promise<T>): Promise<{ acquired: boolean; value?: T }>;
    loadVelocityReviewControl(): Promise<VelocityReviewControl>;
    listCompletedRunDates(): Promise<Set<string>>;
    createOrResumeRun(targetDate: string): Promise<VelocityReviewRun>;
    transitionRunStatus(id: string, expected: VelocityReviewRunStatus, next: VelocityReviewRunStatus,
      counts: RunSummaryCounts): Promise<VelocityReviewRun | null>;
  };
  summary: { send(result: VelocityReviewRunResult): Promise<boolean | void> };
  limits?: Readonly<ProcessorLimits>;
}
function result(row: VelocityReviewExport, workflowAcknowledged = false,
  contactUpserted = false): ExportProcessResult {
  return { exportId: row.id, state: row.state, errorCode: row.errorCode,
    nextAttemptAt: row.nextAttemptAt, workflowAcknowledged, contactUpserted };
}

async function move(deps: ProcessorDependencies, row: VelocityReviewExport, next: ExportState,
  updates: ExportTransitionUpdates = {}): Promise<VelocityReviewExport> {
  const changed = await deps.exports.transitionExportState(row.id, row.state, next, updates);
  if (!changed) throw new Error('Velocity review export state changed concurrently');
  return changed;
}
async function failRequest(deps: ProcessorDependencies, row: VelocityReviewExport,
  error: unknown, code: string, contactUpserted = false): Promise<ExportProcessResult> {
  if (error instanceof HighLevelRequestError && error.ambiguousMutation) {
    return result(await move(deps, row, 'ambiguous', {
      errorCode: `${code}_ambiguous`, nextAttemptAt: null,
    }), false, contactUpserted);
  }
  if (error instanceof HighLevelRequestError && error.retryable) {
    const retryAt = nextRetryAt(deps.now(), row.attemptCount, error.retryAfterSeconds);
    if (retryAt) return result(await move(deps, row, 'retryable_failure', {
      errorCode: code, nextAttemptAt: retryAt,
    }), false, contactUpserted);
  }
  return result(await move(deps, row, 'permanent_failure', {
    errorCode: code, nextAttemptAt: null,
  }), false, contactUpserted);
}
function verifiedPhone(contact: HighLevelContact, expected: string): boolean {
  const normalized = normalizeSaMobileMsisdn(contact.phone);
  return normalized !== null && toE164(normalized) === expected;
}
export async function processOneExport(item: ProcessableExport,
  deps: ProcessorDependencies): Promise<ExportProcessResult> {
  let row = item.export;
  let consent: 'granted' | 'withdrawn';
  try {
    consent = await deps.consent.recordOneMapConsent({ msisdn: item.candidate.msisdn,
      drNumber: item.candidate.drNumber, consentEvidence: item.candidate.consentEvidence });
  } catch {
    const retryAt = nextRetryAt(deps.now(), row.attemptCount);
    const state = retryAt ? 'retryable_failure' : 'permanent_failure';
    return result(await move(deps, row, state, { errorCode: 'consent_verification_failed', nextAttemptAt: retryAt }));
  }
  if (consent === 'withdrawn') {
    return result(await move(deps, row, 'permanent_failure', { errorCode: 'consent_withdrawn' }));
  }
  let upserted: HighLevelContact;
  try {
    upserted = await deps.ghl.upsertContact({ phoneE164: row.phoneE164,
      firstName: item.candidate.firstName, lastName: item.candidate.lastName,
      drNumber: row.drNumber, eventDate: row.firstTargetDate, sources: row.sourceFlags, exportKey: row.exportKey });
  } catch (error) {
    return failRequest(deps, row, error, 'ghl_upsert_failed');
  }
  let current: HighLevelContact;
  try {
    current = await deps.ghl.getContact(upserted.id);
  } catch (error) {
    return failRequest(deps, row, error, 'ghl_readback_failed', true);
  }
  if (current.whatsappDndBlocked) {
    return result(await move(deps, row, 'permanent_failure', { ghlContactId: current.id,
      errorCode: 'ghl_whatsapp_dnd' }), false, true);
  }
  if (!verifiedPhone(current, row.phoneE164) || current.customFields[deps.exportKeyFieldId] !== row.exportKey) {
    return result(await move(deps, row, 'ambiguous', { ghlContactId: current.id,
      errorCode: 'contact_verification_failed' }), false, true);
  }
  const hasTransientTag = current.tags.includes(READY_TAG) || current.tags.includes(ENROLLED_TAG);
  if (hasTransientTag) {
    return result(await move(deps, row, 'ambiguous', {
      ghlContactId: current.id, errorCode: 'stale_transient_tag',
    }), false, true);
  }
  row = await move(deps, row, 'contact_upserted', { ghlContactId: current.id, upsertedAt: deps.now() });
  try {
    await deps.ghl.addTags(current.id, [READY_TAG]);
  } catch (error) {
    return failRequest(deps, row, error, 'tag_add', true);
  }
  row = await move(deps, row, 'trigger_requested', { triggerRequestedAt: deps.now() });
  for (let elapsed = 0; elapsed < POLL_LIMIT_MS; elapsed += POLL_INTERVAL_MS) {
    await deps.sleep(POLL_INTERVAL_MS);
    try {
      current = await deps.ghl.getContact(current.id);
    } catch {
      continue;
    }
    const acknowledged = current.customFields[deps.exportKeyFieldId] === row.exportKey
      && current.tags.includes(ENROLLED_TAG) && !current.tags.includes(READY_TAG);
    if (!acknowledged) continue;
    const acknowledgedAt = deps.now();
    row = await move(deps, row, 'ack_cleanup_pending', { workflowAcknowledgedAt: acknowledgedAt,
      nextAttemptAt: cleanupLeaseUntil(acknowledgedAt) });
    return { ...await processAcknowledgementCleanup(row, deps), contactUpserted: true };
  }
  return result(await move(deps, row, 'ambiguous', {
    errorCode: 'workflow_acknowledgement_timeout',
  }), false, true);
}
function sastDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(now);
}
function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function addCounts(target: RunSummaryCounts, source: RunSummaryCounts): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}
interface DiscoveryResult { decisions: CandidateDecision[]; counts: RunSummaryCounts }

async function discover(date: string, deps: ProcessorDependencies): Promise<DiscoveryResult> {
  const rows = await deps.candidates.listCandidateRows(date);
  const decisions = rows.map((row) => deps.candidates.prepareCandidate(row));
  const counts: RunSummaryCounts = {
    candidate_total: decisions.length,
    ready: decisions.filter((item) => item.status === 'ready').length,
    quarantined: decisions.filter((item) => item.status === 'quarantined').length,
    contacts_upserted: 0,
  };
  for (const source of CANDIDATE_SOURCES) counts[`source_${source}`] = 0;
  for (const reason of QUARANTINE_REASONS) counts[`quarantine_${reason}`] = 0;
  for (const row of rows) {
    for (const source of new Set(row.sources ?? [])) {
      counts[`source_${source}`] = (counts[`source_${source}`] ?? 0) + 1;
    }
  }
  for (const decision of decisions) {
    if (decision.status === 'quarantined') {
      const key = `quarantine_${decision.reason}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return { decisions, counts };
}

async function dryRun(input: VelocityReviewRunInput, deps: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const date = input.targetDate ?? previousDate(sastDate(deps.now()));
  const { counts } = await discover(date, deps);
  return { status: 'dry_run', counts, dates: [{ targetDate: date, status: 'complete', counts }] };
}

interface ProcessingContext extends ProcessableExport { processed: boolean; contactUpserted: boolean }
interface DateWork { run: VelocityReviewRun; targetDate: string; discoveryCounts: RunSummaryCounts;
  exportIds: string[]; duplicates: number; pilotDeferred: number }

async function prepareDate(targetDate: string, pilotLimit: number | null, deps: ProcessorDependencies,
  contexts: Map<string, ProcessingContext>): Promise<DateWork> {
  const run = await deps.runs.createOrResumeRun(targetDate);
  await deps.runs.transitionRunStatus(run.id, run.status, 'running', run.counts);
  const discovery = await discover(targetDate, deps);
  const ordered = [...discovery.decisions].sort((a, b) => {
    const left = a.status === 'ready' ? a.candidate.drNumber : a.drNumber;
    const right = b.status === 'ready' ? b.candidate.drNumber : b.drNumber;
    return left.localeCompare(right);
  });
  for (const decision of ordered) await deps.exports.saveCandidateDecision(run, decision);
  const ready = ordered.flatMap((item) => item.status === 'ready' ? [item.candidate] : []);
  const selected = pilotLimit === null ? ready : ready.slice(0, pilotLimit);
  const exportIds: string[] = []; let duplicates = 0;
  for (const candidate of selected) {
    const saved = await deps.exports.createExport(run, candidate);
    if (!saved.created) duplicates += 1;
    const suppressedTerminal = !saved.created
      && (saved.export.state === 'completed' || saved.export.state === 'permanent_failure');
    if (!suppressedTerminal) {
      contexts.set(saved.export.id, {
        export: saved.export, candidate, processed: false, contactUpserted: false,
      });
      exportIds.push(saved.export.id);
    }
  }
  return { run, targetDate, discoveryCounts: discovery.counts, exportIds, duplicates,
    pilotDeferred: pilotLimit === null ? 0 : Math.max(0, ready.length - selected.length) };
}

async function finishDate(work: DateWork, contexts: Map<string, ProcessingContext>,
  deadlineDeferredIds: ReadonlySet<string>,
  deps: ProcessorDependencies): Promise<VelocityReviewDateResult> {
  const states = work.exportIds.map((id) => contexts.get(id)?.export.state ?? 'ambiguous');
  const processed = work.exportIds.flatMap((id) => {
    const item = contexts.get(id);
    return item?.processed ? [item] : [];
  });
  const processedStates = processed.map((item) => item.export.state);
  const retryable = processedStates.filter((state) => state === 'retryable_failure').length;
  const ambiguous = processedStates.filter((state) => state === 'ambiguous').length;
  const cleanupPending = processedStates.filter((state) => state === 'ack_cleanup_pending').length;
  const deadlineDeferred = work.exportIds.filter((id) => deadlineDeferredIds.has(id)).length;
  const counts: RunSummaryCounts = { ...work.discoveryCounts,
    contacts_upserted: processed.filter((item) => item.contactUpserted).length,
    completed: processedStates.filter((state) => state === 'completed').length,
    permanent_failure: processedStates.filter((state) => state === 'permanent_failure').length,
    retryable, ambiguous, ack_cleanup_pending: cleanupPending, pilot_deferred: work.pilotDeferred,
    deadline_deferred: deadlineDeferred,
    duplicates: work.duplicates };
  const incomplete = work.pilotDeferred > 0 || retryable > 0 || ambiguous > 0
    || cleanupPending > 0 || deadlineDeferred > 0
    || states.some((state) => state === 'ready' || state === 'upserting'
      || state === 'contact_upserted' || state === 'trigger_requested');
  const status: VelocityReviewRunStatus = incomplete ? 'partial' : 'complete';
  await deps.runs.transitionRunStatus(work.run.id, 'running', status, counts);
  return { targetDate: work.targetDate, status, counts };
}

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
      claimDueAcknowledgementCleanup, transitionExportState },
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
