import { listCandidateRows } from './candidateRepository';
import { prepareCandidate } from './candidateService';
import { processAcknowledgementCleanup } from './acknowledgementCleanup';
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
import {
  createOrResumeRun, listCompletedRunDates, loadVelocityReviewControl, selectDueDates,
  transitionRunStatus, withVelocityReviewLock, type VelocityReviewControl,
  type VelocityReviewRun, type VelocityReviewRunStatus,
} from './runRepository';
import type { CandidateDbRow, CandidateDecision, ExportState, PreparedCandidate, RunSummaryCounts } from './types';
const READY_TAG = 'velocity-review-ready';
const ENROLLED_TAG = 'velocity-review-enrolled';
const POLL_INTERVAL_MS = 5_000;
const POLL_LIMIT_MS = 30_000;
interface GhlOperations {
  upsertContact(input: VelocityReviewContactInput): Promise<HighLevelContact>;
  getContact(contactId: string): Promise<HighLevelContact>;
  addTags(contactId: string, tags: readonly string[]): Promise<void>;
  removeTags(contactId: string, tags: readonly string[]): Promise<void>;
}
export interface ProcessableExport { export: VelocityReviewExport; candidate: PreparedCandidate }
export interface ExportProcessResult {
  exportId: string; state: ExportState; errorCode: string | null;
  nextAttemptAt: Date | null; workflowAcknowledged: boolean;
}
export interface VelocityReviewRunInput { dryRun?: boolean; targetDate?: string }
export interface VelocityReviewDateResult { targetDate: string; status: VelocityReviewRunStatus; counts: RunSummaryCounts }
export interface VelocityReviewRunResult {
  status: 'disabled' | 'busy' | 'dry_run' | 'blocked' | 'complete' | 'partial' | 'pilot';
  counts: RunSummaryCounts; dates: VelocityReviewDateResult[]; reason?: string;
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
    claimDueAcknowledgementCleanup(now: Date, eligibleExportIds: readonly string[]): Promise<VelocityReviewExport | null>;
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
}
function result(row: VelocityReviewExport, workflowAcknowledged = false): ExportProcessResult {
  return { exportId: row.id, state: row.state, errorCode: row.errorCode,
    nextAttemptAt: row.nextAttemptAt, workflowAcknowledged };
}

async function move(deps: ProcessorDependencies, row: VelocityReviewExport, next: ExportState,
  updates: ExportTransitionUpdates = {}): Promise<VelocityReviewExport> {
  const changed = await deps.exports.transitionExportState(row.id, row.state, next, updates);
  if (!changed) throw new Error('Velocity review export state changed concurrently');
  return changed;
}
async function failRequest(deps: ProcessorDependencies, row: VelocityReviewExport,
  error: unknown, code: string): Promise<ExportProcessResult> {
  if (error instanceof HighLevelRequestError && error.ambiguousMutation) {
    return result(await move(deps, row, 'ambiguous', { errorCode: `${code}_ambiguous`, nextAttemptAt: null }));
  }
  if (error instanceof HighLevelRequestError && error.retryable) {
    const retryAt = nextRetryAt(deps.now(), row.attemptCount, error.retryAfterSeconds);
    if (retryAt) return result(await move(deps, row, 'retryable_failure', { errorCode: code, nextAttemptAt: retryAt }));
  }
  return result(await move(deps, row, 'permanent_failure', { errorCode: code, nextAttemptAt: null }));
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
    return failRequest(deps, row, error, 'ghl_readback_failed');
  }
  if (current.whatsappDndBlocked) {
    return result(await move(deps, row, 'permanent_failure', { ghlContactId: current.id,
      errorCode: 'ghl_whatsapp_dnd' }));
  }
  if (!verifiedPhone(current, row.phoneE164) || current.customFields[deps.exportKeyFieldId] !== row.exportKey) {
    return result(await move(deps, row, 'ambiguous', { ghlContactId: current.id,
      errorCode: 'contact_verification_failed' }));
  }
  const hasTransientTag = current.tags.includes(READY_TAG) || current.tags.includes(ENROLLED_TAG);
  if (hasTransientTag) {
    return result(await move(deps, row, 'ambiguous', { ghlContactId: current.id, errorCode: 'stale_transient_tag' }));
  }
  row = await move(deps, row, 'contact_upserted', { ghlContactId: current.id, upsertedAt: deps.now() });
  try {
    await deps.ghl.addTags(current.id, [READY_TAG]);
  } catch (error) {
    return failRequest(deps, row, error, 'tag_add');
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
    row = await move(deps, row, 'ack_cleanup_pending', { workflowAcknowledgedAt: deps.now() });
    return processAcknowledgementCleanup(row, deps);
  }
  return result(await move(deps, row, 'ambiguous', { errorCode: 'workflow_acknowledgement_timeout' }));
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
async function discover(date: string, deps: ProcessorDependencies): Promise<CandidateDecision[]> {
  const rows = await deps.candidates.listCandidateRows(date);
  return rows.map((row) => deps.candidates.prepareCandidate(row));
}

async function dryRun(input: VelocityReviewRunInput, deps: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const date = input.targetDate ?? previousDate(sastDate(deps.now()));
  const decisions = await discover(date, deps);
  const counts = { candidate_total: decisions.length,
    ready: decisions.filter((item) => item.status === 'ready').length,
    quarantined: decisions.filter((item) => item.status === 'quarantined').length };
  return { status: 'dry_run', counts, dates: [{ targetDate: date, status: 'complete', counts }] };
}

interface DateWork { run: VelocityReviewRun; targetDate: string; decisions: number; ready: number;
  exportIds: string[]; duplicates: number; pilotDeferred: number }

async function prepareDate(targetDate: string, pilotLimit: number | null, deps: ProcessorDependencies,
  contexts: Map<string, ProcessableExport>): Promise<DateWork> {
  const run = await deps.runs.createOrResumeRun(targetDate);
  await deps.runs.transitionRunStatus(run.id, run.status, 'running', run.counts);
  const decisions = await discover(targetDate, deps);
  const ordered = [...decisions].sort((a, b) => {
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
    contexts.set(saved.export.id, { export: saved.export, candidate });
    exportIds.push(saved.export.id);
  }
  return { run, targetDate, decisions: decisions.length, ready: ready.length, exportIds, duplicates,
    pilotDeferred: pilotLimit === null ? 0 : Math.max(0, ready.length - selected.length) };
}

async function finishDate(work: DateWork, contexts: Map<string, ProcessableExport>,
  deps: ProcessorDependencies): Promise<VelocityReviewDateResult> {
  const states = work.exportIds.map((id) => contexts.get(id)?.export.state ?? 'ambiguous');
  const retryable = states.filter((state) => state === 'retryable_failure').length;
  const ambiguous = states.filter((state) => state === 'ambiguous').length;
  const cleanupPending = states.filter((state) => state === 'ack_cleanup_pending').length;
  const counts: RunSummaryCounts = { candidate_total: work.decisions, ready: work.ready,
    quarantined: work.decisions - work.ready, completed: states.filter((state) => state === 'completed').length,
    permanent_failure: states.filter((state) => state === 'permanent_failure').length,
    retryable, ambiguous, ack_cleanup_pending: cleanupPending, pilot_deferred: work.pilotDeferred,
    duplicates: work.duplicates };
  const incomplete = work.pilotDeferred > 0 || retryable > 0 || ambiguous > 0
    || cleanupPending > 0 || states.some((state) => state === 'ready' || state === 'upserting'
      || state === 'contact_upserted' || state === 'trigger_requested');
  const status: VelocityReviewRunStatus = incomplete ? 'partial' : 'complete';
  await deps.runs.transitionRunStatus(work.run.id, 'running', status, counts);
  return { targetDate: work.targetDate, status, counts };
}

async function lockedRun(deps: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const control = await deps.runs.loadVelocityReviewControl();
  if (!control.automationEnabled && !control.pilotEnabled) return { status: 'disabled', counts: {}, dates: [] };
  const completed = await deps.runs.listCompletedRunDates();
  const due = selectDueDates(control, completed, previousDate(sastDate(deps.now())));
  if (due.status === 'disabled') return { status: 'disabled', counts: {}, dates: [] };
  if (due.status === 'blocked') {
    const blocked = { status: 'blocked' as const, reason: due.reason, counts: {}, dates: [] };
    await deps.summary.send(blocked); return blocked;
  }
  const contexts = new Map<string, ProcessableExport>(); const work: DateWork[] = [];
  for (const date of due.dates) {
    work.push(await prepareDate(date, due.status === 'pilot' ? due.limit : null, deps, contexts));
  }
  const eligibleIds = [...contexts.keys()];
  for (;;) {
    const claimed = await deps.exports.claimNextExport(deps.now(), eligibleIds);
    if (!claimed) {
      const cleanup = await deps.exports.claimDueAcknowledgementCleanup(deps.now(), eligibleIds);
      if (!cleanup) break;
      const item = contexts.get(cleanup.id);
      if (!item) throw new Error('Claimed Velocity review cleanup lacks current candidate evidence');
      const outcome = await processAcknowledgementCleanup(cleanup, deps);
      item.export = { ...item.export, state: outcome.state, errorCode: outcome.errorCode,
        nextAttemptAt: outcome.nextAttemptAt };
      continue;
    }
    const item = contexts.get(claimed.id);
    if (!item) throw new Error('Claimed Velocity review export lacks current candidate evidence');
    const outcome = await processOneExport({ ...item, export: claimed }, deps);
    item.export = { ...item.export, state: outcome.state, errorCode: outcome.errorCode,
      nextAttemptAt: outcome.nextAttemptAt };
  }
  const dates: VelocityReviewDateResult[] = []; const counts: RunSummaryCounts = {};
  for (const item of work) { const date = await finishDate(item, contexts, deps);
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
      createOrResumeRun, transitionRunStatus }, summary: { send: async () => undefined } };
}

export async function runVelocityReviewExport(input: VelocityReviewRunInput = {},
  supplied?: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const deps = supplied ?? defaultDependencies(input.dryRun === true);
  if (input.dryRun) return dryRun(input, deps);
  const locked = await deps.runs.withVelocityReviewLock(() => lockedRun(deps));
  return locked.acquired && locked.value ? locked.value : { status: 'busy', counts: {}, dates: [] };
}
