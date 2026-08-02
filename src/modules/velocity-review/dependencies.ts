import type { OneMapConsentInput } from './consentService';
import type { ExportTransitionUpdates, VelocityReviewExport } from './exportRepository';
import type { HighLevelContact, VelocityReviewContactInput } from './ghlClient';
import type {
  VelocityReviewControl, VelocityReviewRun, VelocityReviewRunStatus,
} from './runRepository';
import type {
  CandidateDbRow, CandidateDecision, ExportState, PreparedCandidate, RunSummaryCounts,
} from './types';

/**
 * The injection surface shared by the run loop (processor.ts), the per-export
 * state machine (contactExport.ts) and the per-date orchestration (dateWork.ts).
 *
 * Kept in its own file so those three can depend on the shape without depending
 * on each other.
 */
export interface GhlOperations {
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
