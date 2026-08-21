/**
 * Effective-dated PR8 analytics/retention configuration
 * (`fleet_operational_analytics_settings`, migration 518).
 *
 * Only the READ half lives here. The plan's Task 3 owns
 * `versionAnalyticsRetentionSettings`, which is not built yet; the hold and
 * purge services need the effective row today, so this file exists early with
 * exactly that one function rather than with a stub of the other. Mirrors
 * `../driver/settingsRepository.ts#getEffectiveDriverInputSettings`.
 *
 * It throws when no interval covers the instant instead of returning a
 * default. A default here would be a retention policy nobody configured, and
 * the caller most likely to hit it is the one that deletes things.
 */
import { queryOne } from '@/lib/db-pool';
import type { RetentionHoldCategory } from './aggregateSchema';
import type { RetentionPolicy } from './types';

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
