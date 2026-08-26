/**
 * Effective-dated PR8 analytics/retention configuration
 * (`fleet_operational_analytics_settings`, migration 518).
 *
 * Reading the effective version and opening the next one. Mirrors
 * `../driver/settingsRepository.ts`, including where the rules live: shape
 * validation belongs to the route, every semantic bound to
 * `./retentionSettingsValidation`, and persistence to this file.
 *
 * The read throws when no interval covers the instant instead of returning a
 * default. A default here would be a retention policy nobody configured, and
 * the caller most likely to hit it is the one that deletes things.
 */
import { queryOne, transaction } from '@/lib/db-pool';
import type { RetentionHoldCategory } from './aggregateSchema';
import type { RetentionPolicy } from './types';
import {
  ACKNOWLEDGEMENT_MAX_AGE_DAYS, RetentionSettingsValidationError, requireDryRunAcknowledgement,
  validateRetentionSettingsChange,
} from './retentionSettingsValidation';
import type { AnalyticsRetentionSettingsChangeRequest } from './retentionSettingsValidation';

export { RetentionSettingsValidationError } from './retentionSettingsValidation';
export type { AnalyticsRetentionSettingsChangeRequest } from './retentionSettingsValidation';

const SETTINGS_COLUMNS = `version, effective_from, retention_months, anonymity_min_contributors,
  recalculation_window_months, retention_batch_size, maximum_hold_review_days,
  hold_review_reminder_lead_days, aggregation_run_hour_sast, aggregation_run_minute_sast,
  retention_run_hour_sast, retention_run_minute_sast, aggregate_freshness_warning_hours,
  retention_freshness_warning_hours, permitted_hold_categories, metric_version,
  live_retention_enabled`;

interface SettingsRow extends Record<string, unknown> {
  version: number;
  effective_from: string | Date;
  retention_months: number;
  anonymity_min_contributors: number;
  recalculation_window_months: number;
  retention_batch_size: number;
  maximum_hold_review_days: number;
  hold_review_reminder_lead_days: number;
  aggregation_run_hour_sast: number;
  aggregation_run_minute_sast: number;
  retention_run_hour_sast: number;
  retention_run_minute_sast: number;
  aggregate_freshness_warning_hours: number;
  retention_freshness_warning_hours: number;
  permitted_hold_categories: RetentionHoldCategory[];
  metric_version: number;
  live_retention_enabled: boolean;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** The settings version whose effective interval covers `at` (ISO instant). */
export async function getEffectiveAnalyticsRetentionSettings(at: string): Promise<RetentionPolicy> {
  const row = await queryOne<SettingsRow>(
    `/* fleet-analytics-settings:effective */
     SELECT ${SETTINGS_COLUMNS} FROM fleet_operational_analytics_settings
     WHERE effective_from <= $1::timestamptz AND (effective_to IS NULL OR effective_to > $1::timestamptz)
     ORDER BY version DESC LIMIT 1`,
    [at],
  );
  if (!row) throw new Error(`No Fleet analytics/retention settings interval covers ${at}`);
  return mapSettings(row);
}

function mapSettings(row: SettingsRow): RetentionPolicy {
  return {
    version: row.version,
    effectiveFrom: iso(row.effective_from),
    retentionMonths: row.retention_months,
    anonymityMinContributors: row.anonymity_min_contributors,
    recalculationWindowMonths: row.recalculation_window_months,
    retentionBatchSize: row.retention_batch_size,
    maximumHoldReviewDays: row.maximum_hold_review_days,
    holdReviewReminderLeadDays: row.hold_review_reminder_lead_days,
    aggregationRunHourSast: row.aggregation_run_hour_sast,
    aggregationRunMinuteSast: row.aggregation_run_minute_sast,
    retentionRunHourSast: row.retention_run_hour_sast,
    retentionRunMinuteSast: row.retention_run_minute_sast,
    aggregateFreshnessWarningHours: row.aggregate_freshness_warning_hours,
    retentionFreshnessWarningHours: row.retention_freshness_warning_hours,
    permittedHoldCategories: row.permitted_hold_categories,
    metricVersion: row.metric_version,
    liveRetentionEnabled: row.live_retention_enabled,
  };
}

const INSERT_COLUMNS = `version, effective_from, retention_months, anonymity_min_contributors,
  recalculation_window_months, retention_batch_size, maximum_hold_review_days,
  hold_review_reminder_lead_days, aggregation_run_hour_sast, aggregation_run_minute_sast,
  retention_run_hour_sast, retention_run_minute_sast, aggregate_freshness_warning_hours,
  retention_freshness_warning_hours, permitted_hold_categories, metric_version,
  live_retention_enabled, created_by, change_reason`;

/**
 * Opens the next settings version and closes the one it replaces.
 *
 * Effective-dated rather than updated in place, exactly like the driver-input
 * and rule surfaces: a purge that ran last week must remain explicable by the
 * policy that was in force when it ran, and an UPDATE would erase the only
 * record of what that policy was.
 *
 * The open row is locked with `FOR UPDATE` before it is read. Two operators
 * saving at once would otherwise both read version N, both write N+1, and the
 * unique index on `version` would fail the second one — after it had already
 * closed the first one's row.
 */
export async function versionAnalyticsRetentionSettings(
  request: AnalyticsRetentionSettingsChangeRequest, actorUserId: string,
): Promise<RetentionPolicy> {
  const normalized = validateRetentionSettingsChange(request);

  return transaction(async (txn) => {
    const current = await txn.queryOne<SettingsRow>(
      `/* fleet-analytics-settings:lock-open */
       SELECT ${SETTINGS_COLUMNS} FROM fleet_operational_analytics_settings
        WHERE effective_to IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    );
    if (!current) {
      throw new RetentionSettingsValidationError('No open Fleet analytics/retention settings version exists');
    }
    if (Date.parse(normalized.effectiveFrom) <= Date.parse(iso(current.effective_from))) {
      throw new RetentionSettingsValidationError(
        'effectiveFrom must be after the version it replaces',
      );
    }

    const dryRunId = requireDryRunAcknowledgement(
      { retentionMonths: current.retention_months, liveRetentionEnabled: current.live_retention_enabled },
      request,
    );
    if (dryRunId !== null) {
      /**
       * Three clauses, and the gate is worth nothing without all three.
       *
       *   `dry_run = true` — a LIVE run is not an acknowledgement of anything,
       *     it is the deletion itself.
       *   `policy_months = $2` — a dry run at 24 months says nothing about
       *     what a 6-month policy would delete. Without this clause any run
       *     ever performed, at any window, would arm the change.
       *   `started_at > now() - 14 days` — a run from last quarter describes a
       *     dataset that no longer exists; incidents have aged past the cutoff
       *     since, and they are exactly the ones this change would delete.
       */
      const reviewed = await txn.queryOne<{ id: string }>(
        `/* fleet-analytics-settings:acknowledged-dry-run */
         SELECT id FROM fleet_operational_retention_runs
          WHERE id = $1::uuid AND dry_run = true AND policy_months = $2
            AND started_at > now() - ($3 || ' days')::interval`,
        [dryRunId, request.retentionMonths, String(ACKNOWLEDGEMENT_MAX_AGE_DAYS)],
      );
      if (!reviewed) {
        throw new RetentionSettingsValidationError(
          `acknowledgedDryRunId ${dryRunId} does not name a dry retention run at `
          + `${request.retentionMonths} months started within the last ${ACKNOWLEDGEMENT_MAX_AGE_DAYS} days`,
        );
      }
    }

    await txn.query(
      `/* fleet-analytics-settings:close-open */
       UPDATE fleet_operational_analytics_settings SET effective_to = $1::timestamptz, updated_at = now()
        WHERE version = $2`,
      [normalized.effectiveFrom, current.version],
    );

    const created = await txn.queryOne<SettingsRow>(
      `/* fleet-analytics-settings:insert */
       INSERT INTO fleet_operational_analytics_settings (${INSERT_COLUMNS})
       VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16,$17,$18::uuid,$19)
       RETURNING ${SETTINGS_COLUMNS}`,
      [
        current.version + 1, normalized.effectiveFrom, request.retentionMonths,
        request.anonymityMinContributors, request.recalculationWindowMonths, request.retentionBatchSize,
        request.maximumHoldReviewDays, request.holdReviewReminderLeadDays,
        request.aggregationRunHourSast, request.aggregationRunMinuteSast,
        request.retentionRunHourSast, request.retentionRunMinuteSast,
        request.aggregateFreshnessWarningHours, request.retentionFreshnessWarningHours,
        request.permittedHoldCategories, request.metricVersion, request.liveRetentionEnabled,
        // The session actor, always. Never an actor named in the request body.
        actorUserId, normalized.reason,
      ],
    );
    if (!created) throw new Error('Fleet analytics/retention settings insert returned no row');
    return mapSettings(created);
  });
}
