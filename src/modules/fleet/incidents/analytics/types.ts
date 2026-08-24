/**
 * Fleet operations analytics and retention DTOs (PR8, migration 518).
 *
 * The closed value sets these DTOs are typed against live in
 * `./aggregateSchema`, which mirrors the migration's CHECK constraints. They
 * are re-exported here so callers have a single import site.
 */

export * from './aggregateSchema';
import type {
  AggregateDimensionLevel,
  AggregateMetricKind,
  OperationsMetricKey,
  RetentionHoldActionType,
  RetentionHoldCategory,
  RetentionHoldStatus,
  RetentionItemStage,
  RunStatus,
  TimelineSource,
} from './aggregateSchema';

export interface DurationHistogram {
  sampleCount: number;
  sumSeconds: number;
  /** Counts per DURATION_BUCKET_COLUMNS, same order. */
  buckets: readonly number[];
}

export interface MonthlyAggregateRow {
  id: string;
  metricVersion: number;
  /** Always the first day of the month, in SAST terms. Never an exact time. */
  monthStart: string;
  dimensionLevel: AggregateDimensionLevel;
  dimensionProjectId: string | null;
  dimensionSiteId: string | null;
  generalizedFromLevel: AggregateDimensionLevel | null;
  metricKey: OperationsMetricKey;
  metricKind: AggregateMetricKind;
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  contributorCount: number;
  isActive: boolean;
  checksum: string | null;
}

// ---------------------------------------------------------------------------
// Runs, settings, holds
// ---------------------------------------------------------------------------

export interface AggregationRun {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  metricVersion: number;
  monthsRequested: number;
  monthsSucceeded: number;
  monthsFailed: number;
  rowsWritten: number;
  errorCode: string | null;
}

export interface RetentionPolicy {
  version: number;
  effectiveFrom: string;
  retentionMonths: number;
  anonymityMinContributors: number;
  recalculationWindowMonths: number;
  retentionBatchSize: number;
  maximumHoldReviewDays: number;
  holdReviewReminderLeadDays: number;
  aggregationRunHourSast: number;
  aggregationRunMinuteSast: number;
  retentionRunHourSast: number;
  retentionRunMinuteSast: number;
  aggregateFreshnessWarningHours: number;
  retentionFreshnessWarningHours: number;
  permittedHoldCategories: readonly RetentionHoldCategory[];
  metricVersion: number;
  liveRetentionEnabled: boolean;
}

export interface RetentionHold {
  id: string;
  incidentId: string;
  category: RetentionHoldCategory;
  status: RetentionHoldStatus;
  reason: string;
  ownerUserId: string;
  holdStartAt: string;
  nextReviewAt: string;
  lastReviewedAt: string | null;
  releasedAt: string | null;
}

export interface RetentionHoldAction {
  id: string;
  holdId: string;
  actionType: RetentionHoldActionType;
  actorUserId: string;
  occurredAt: string;
  note: string | null;
  previousNextReviewAt: string | null;
  newNextReviewAt: string | null;
}

export interface RetentionRun {
  id: string;
  status: RunStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  cutoffWorkDate: string;
  itemsConsidered: number;
  itemsClaimed: number;
  itemsCompleted: number;
  itemsFailed: number;
  itemsSkippedHold: number;
  itemsSkippedCoverage: number;
  storageObjectsDeleted: number;
  errorCode: string | null;
}

export interface RetentionItem {
  id: string;
  retentionRunId: string;
  /** Cleared to null once the database purge completes — enforced by CHECK. */
  incidentId: string | null;
  stage: RetentionItemStage;
  storageObjectsTotal: number;
  storageObjectsDeleted: number;
  attempts: number;
  lastErrorCode: string | null;
}

// ---------------------------------------------------------------------------
// Query and response contracts
// ---------------------------------------------------------------------------

export interface OperationsFilters {
  start: string;
  end: string;
  projectId?: string;
  managerUserId?: string;
  operationalSiteId?: string;
  incidentType?: string;
  severity?: string;
  outcome?: string;
  /** Retained-detail only. Never applied to an aggregate query. */
  staffId?: string;
  /** Retained-detail only. Never applied to an aggregate query. */
  vehicleId?: string;
  evidenceAvailable?: boolean;
}

export interface IncidentTimelineEntry {
  stableId: string;
  source: TimelineSource;
  entryType: string;
  occurredAt: string;
  recordedAt: string;
  summary: string;
  actorLabel: string | null;
}

/**
 * One page of chronology. The cursor encodes the ordering triple of the last
 * entry returned, so a page boundary that falls between two entries sharing an
 * `occurredAt` still resumes in exactly one place.
 */
export interface IncidentTimelinePage {
  entries: IncidentTimelineEntry[];
  nextCursor: string | null;
}

export interface OperationsMetricValue {
  metricKey: OperationsMetricKey;
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  /** True when this value came from a generalized (suppressed) group. */
  generalized: boolean;
}

export interface OperationsAnalyticsResponse {
  filters: OperationsFilters;
  metricVersion: number;
  /** Months at or after this boundary still have retained detail. */
  retainedDetailFrom: string;
  cards: OperationsMetricValue[];
  series: { monthStart: string; values: OperationsMetricValue[] }[];
  suppressionNotices: string[];
  freshness: { aggregatesThrough: string | null; lastRunStatus: RunStatus | null };
}

export type OperationsDrillDownMode = 'retained_detail' | 'aggregate_only';

export interface OperationsDrillDownResponse {
  mode: OperationsDrillDownMode;
  values: OperationsMetricValue[];
  /** Populated only in retained_detail mode, and only within actor scope. */
  incidentIds: string[];
  nextCursor: string | null;
}

export interface CreateRetentionHoldCommand {
  incidentId: string;
  category: RetentionHoldCategory;
  reason: string;
  ownerUserId: string;
  nextReviewAt: string;
}

export interface ReviewRetentionHoldCommand {
  holdId: string;
  /** The incident the caller reached this hold through; verified against the hold's own incident. */
  incidentId?: string;
  note: string;
  nextReviewAt: string;
}

export interface ReleaseRetentionHoldCommand {
  holdId: string;
  /** The incident the caller reached this hold through; verified against the hold's own incident. */
  incidentId?: string;
  releaseReason: string;
}
