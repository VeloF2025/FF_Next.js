/**
 * Semantic validation for a PR8 analytics/retention settings change
 * (stage 8, task 9b).
 *
 * Every bound below mirrors a CHECK constraint in migration 518. It is
 * duplicated here on purpose: the database is the thing that ENFORCES these,
 * but a caller who trips one gets `23514 fleet_operational_analytics_settings_
 * batch_bounded`, which names a constraint rather than a field and reaches the
 * UI as a 500. Validating first turns that into a sentence naming what is
 * wrong, and puts the rules where a reader of the module can see them.
 *
 * Kept out of `settingsRepository` so that file stays about persistence, and so
 * these rules can be tested without a transaction double.
 */
import { RETENTION_HOLD_CATEGORIES } from './aggregateSchema';
import type { RetentionHoldCategory } from './aggregateSchema';
import { parseStrictIsoInstant } from '../../operations/instantValidation';

export class RetentionSettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'RetentionSettingsValidationError'; }
}

export interface AnalyticsRetentionSettingsChangeRequest {
  /** ISO instant. Must be strictly after the version being replaced. */
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
  permittedHoldCategories: RetentionHoldCategory[];
  metricVersion: number;
  liveRetentionEnabled: boolean;
  changeReason?: string | null;
  /**
   * A dry retention run the operator reviewed before shortening the window.
   * Required ONLY when `retentionMonths` decreases — see `assertShorteningIsAcknowledged`.
   */
  acknowledgedDryRunId?: string | null;
}

function integerBetween(value: number, low: number, high: number, field: string): void {
  if (!Number.isInteger(value) || value < low || value > high) {
    throw new RetentionSettingsValidationError(`${field} must be a whole number between ${low} and ${high}`);
  }
}

export interface NormalizedSettingsChange {
  effectiveFrom: string;
  reason: string | null;
}

export function validateRetentionSettingsChange(
  request: AnalyticsRetentionSettingsChangeRequest,
): NormalizedSettingsChange {
  if (parseStrictIsoInstant(request.effectiveFrom) === null) {
    throw new RetentionSettingsValidationError('effectiveFrom must be a valid ISO instant');
  }

  integerBetween(request.retentionMonths, 1, 120, 'retentionMonths');
  // Five is a floor, not a default: the aggregate table's own CHECK refuses a
  // contributor count below it, so a settings row that allowed less would only
  // produce months that fail to store.
  integerBetween(request.anonymityMinContributors, 5, 1000, 'anonymityMinContributors');
  integerBetween(request.recalculationWindowMonths, 1, 24, 'recalculationWindowMonths');
  integerBetween(request.retentionBatchSize, 1, 100, 'retentionBatchSize');
  integerBetween(request.maximumHoldReviewDays, 1, 90, 'maximumHoldReviewDays');
  integerBetween(request.holdReviewReminderLeadDays, 1, request.maximumHoldReviewDays,
    'holdReviewReminderLeadDays');
  integerBetween(request.aggregationRunHourSast, 0, 23, 'aggregationRunHourSast');
  integerBetween(request.aggregationRunMinuteSast, 0, 59, 'aggregationRunMinuteSast');
  integerBetween(request.retentionRunHourSast, 0, 23, 'retentionRunHourSast');
  integerBetween(request.retentionRunMinuteSast, 0, 59, 'retentionRunMinuteSast');
  integerBetween(request.aggregateFreshnessWarningHours, 1, 8760, 'aggregateFreshnessWarningHours');
  integerBetween(request.retentionFreshnessWarningHours, 1, 8760, 'retentionFreshnessWarningHours');
  integerBetween(request.metricVersion, 1, 1_000_000, 'metricVersion');

  if (request.permittedHoldCategories.length === 0) {
    throw new RetentionSettingsValidationError('permittedHoldCategories must name at least one category');
  }
  const permitted: readonly string[] = RETENTION_HOLD_CATEGORIES;
  const unknown = request.permittedHoldCategories.filter((category) => !permitted.includes(category));
  if (unknown.length > 0) {
    throw new RetentionSettingsValidationError(
      `permittedHoldCategories contains ${unknown.join(', ')}; the known categories are ${permitted.join(', ')}`,
    );
  }
  if (typeof request.liveRetentionEnabled !== 'boolean') {
    throw new RetentionSettingsValidationError('liveRetentionEnabled must be a boolean');
  }

  const reason = request.changeReason?.trim();
  return { effectiveFrom: request.effectiveFrom, reason: reason ? reason : null };
}

/**
 * Shortening the window is the only change on this form that DESTROYS data.
 *
 * Every terminal incident between the new cutoff and the old one becomes
 * eligible for deletion the next time the purge runs — a change of a few
 * characters, applied by a nightly job hours later, with no undo. So it is
 * gated on a dry run that was actually performed, rather than on a checkbox:
 * an id can be looked up and shown to have existed, and a boolean proves only
 * that somebody clicked past a warning.
 *
 * Lengthening and leaving it alone need no ceremony — neither makes anything
 * newly deletable.
 */
export function assertShorteningIsAcknowledged(
  currentMonths: number, requestedMonths: number, acknowledgedDryRunId: string | null | undefined,
): string | null {
  if (requestedMonths >= currentMonths) return null;
  if (!acknowledgedDryRunId) {
    throw new RetentionSettingsValidationError(
      `Shortening retention from ${currentMonths} to ${requestedMonths} months makes more incidents `
      + 'deletable at the next purge. Review a dry run first and name it as acknowledgedDryRunId.',
    );
  }
  return acknowledgedDryRunId;
}
