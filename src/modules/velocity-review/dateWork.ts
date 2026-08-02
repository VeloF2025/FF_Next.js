import type { VelocityReviewRun, VelocityReviewRunStatus } from './runRepository';
import {
  CANDIDATE_SOURCES, QUARANTINE_REASONS,
  type CandidateDecision, type RunSummaryCounts,
} from './types';
import type {
  ProcessableExport, ProcessorDependencies,
  VelocityReviewDateResult, VelocityReviewRunInput, VelocityReviewRunResult,
} from './dependencies';

export function sastDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(now);
}
export function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function addCounts(target: RunSummaryCounts, source: RunSummaryCounts): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}
export interface DiscoveryResult { decisions: CandidateDecision[]; counts: RunSummaryCounts }

export async function discover(date: string, deps: ProcessorDependencies): Promise<DiscoveryResult> {
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

export async function dryRun(input: VelocityReviewRunInput, deps: ProcessorDependencies): Promise<VelocityReviewRunResult> {
  const date = input.targetDate ?? previousDate(sastDate(deps.now()));
  const { counts } = await discover(date, deps);
  return { status: 'dry_run', counts, dates: [{ targetDate: date, status: 'complete', counts }] };
}

export interface ProcessingContext extends ProcessableExport { processed: boolean; contactUpserted: boolean }
export interface DateWork { run: VelocityReviewRun; targetDate: string; discoveryCounts: RunSummaryCounts;
  exportIds: string[]; duplicates: number; pilotDeferred: number }

export async function prepareDate(targetDate: string, pilotLimit: number | null, deps: ProcessorDependencies,
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

export async function finishDate(work: DateWork, contexts: Map<string, ProcessingContext>,
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
