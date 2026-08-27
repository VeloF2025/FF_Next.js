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
   * A dry retention run the operator reviewed before arming or narrowing the
   * purge. Required when `retentionMonths` decreases, and when
   * `liveRetentionEnabled` goes false→true — see `requireDryRunAcknowledgement`.
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
  nowMs: number = Date.now(),
): NormalizedSettingsChange {
  const effectiveFromMs = parseStrictIsoInstant(request.effectiveFrom);
  if (effectiveFromMs === null) {
    throw new RetentionSettingsValidationError('effectiveFrom must be a valid ISO instant');
  }
  /**
   * A version may be scheduled forward but never backdated. A retention policy
   * is the record of what was in force when a purge ran, so a row that claims
   * to have been effective last month rewrites the justification for deletions
   * that already happened under the version it displaces.
   *
   * NOTE: `../driver/settingsRepository.ts` has the same gap and is NOT fixed
   * here — that surface has its own tests and its own reviewers, and widening
   * this PR to it would ship an unreviewed behaviour change to a second table.
   */
  if (effectiveFromMs < nowMs) {
    throw new RetentionSettingsValidationError(
      'effectiveFrom must not be in the past — a settings version cannot be backdated '
      + 'over purges that already ran under the version it replaces',
    );
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

/** How recent a dry run must be to still describe what the purge would do. */
export const ACKNOWLEDGEMENT_MAX_AGE_DAYS = 14;

/** The state of the version being replaced, as far as the acknowledgement rules care. */
export interface CurrentRetentionState {
  retentionMonths: number;
  liveRetentionEnabled: boolean;
}

/**
 * Two changes on this form DESTROY data, and both are gated the same way.
 *
 *   1. **Shortening the window.** Every terminal incident between the new
 *      cutoff and the old one becomes eligible for deletion at the next purge.
 *   2. **Turning `liveRetentionEnabled` on.** Until that flag flips, the purge
 *      reports and deletes nothing; flipping it is the switch that arms every
 *      incident already past the cutoff — which, on a first arming, is the
 *      entire backlog. Shortening from 12 to 11 gives up one month; arming
 *      gives up everything older than the window in one step.
 *
 * Both are a change of a few characters, applied by a nightly job hours later,
 * with no undo. So both are gated on a dry run that was actually performed
 * rather than on a checkbox: an id can be looked up and shown to have existed,
 * and a boolean proves only that somebody clicked past a warning.
 *
 * The dry run must be **at the months being asked for** and **recent** — see
 * the repository's lookup. A dry run at 24 months says nothing about what a
 * 6-month policy deletes, and one from last quarter says nothing about what
 * today's data does.
 *
 * Lengthening, leaving the window alone, and turning live retention OFF need no
 * ceremony — none of them makes anything newly deletable.
 *
 * @returns the dry-run id the caller must verify, or null when none is needed.
 */
export function requireDryRunAcknowledgement(
  current: CurrentRetentionState,
  request: Pick<AnalyticsRetentionSettingsChangeRequest,
    'retentionMonths' | 'liveRetentionEnabled' | 'acknowledgedDryRunId'>,
): string | null {
  const shortening = request.retentionMonths < current.retentionMonths;
  const arming = request.liveRetentionEnabled && !current.liveRetentionEnabled;
  if (!shortening && !arming) return null;

  if (!request.acknowledgedDryRunId) {
    const what = shortening
      ? `Shortening retention from ${current.retentionMonths} to ${request.retentionMonths} months makes `
        + 'more incidents deletable at the next purge.'
      : 'Enabling live retention arms the purge: every incident already past the cutoff becomes '
        + 'deletable at the next run.';
    throw new RetentionSettingsValidationError(
      `${what} Review a dry run at ${request.retentionMonths} months, started within the last `
      + `${ACKNOWLEDGEMENT_MAX_AGE_DAYS} days, and name it as acknowledgedDryRunId.`,
    );
  }
  return request.acknowledgedDryRunId;
}
