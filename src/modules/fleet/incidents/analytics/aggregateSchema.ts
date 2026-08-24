/**
 * The closed value sets and column allow-list that mirror migration 518
 * (`scripts/migrations/sql/518_fleet_operational_analytics_retention.sql`).
 *
 * Split out of `types.ts` so the SQL-mirroring half stays readable on its own:
 * `__tests__/migrationContract.test.ts` compares every constant in this file to
 * a CHECK constraint or column list in that migration, and fails if the two
 * drift apart. Keep them edited together.
 *
 * The incident and outcome metric keys mirror the production
 * `fleet_operational_incidents` type/outcome CHECK lists from migration 510
 * exactly. They are not an approximation of them.
 *
 * Consumers import from `./types`, which re-exports everything here.
 */

// ---------------------------------------------------------------------------
// Closed value sets
// ---------------------------------------------------------------------------

export const AGGREGATE_DIMENSION_LEVELS = ['site', 'project', 'organisation'] as const;
export type AggregateDimensionLevel = (typeof AGGREGATE_DIMENSION_LEVELS)[number];

export const AGGREGATE_METRIC_KINDS = ['count', 'ratio', 'duration_histogram'] as const;
export type AggregateMetricKind = (typeof AGGREGATE_METRIC_KINDS)[number];

export const RETENTION_ITEM_STAGES = [
  'claimed', 'pending_storage', 'storage_complete', 'database_complete', 'failed',
] as const;
export type RetentionItemStage = (typeof RETENTION_ITEM_STAGES)[number];

export const RETENTION_HOLD_CATEGORIES = [
  'health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved',
] as const;
export type RetentionHoldCategory = (typeof RETENTION_HOLD_CATEGORIES)[number];

export const RETENTION_HOLD_STATUSES = ['active', 'released'] as const;
export type RetentionHoldStatus = (typeof RETENTION_HOLD_STATUSES)[number];

export const RETENTION_HOLD_ACTION_TYPES = ['created', 'reviewed', 'extended', 'released'] as const;
export type RetentionHoldActionType = (typeof RETENTION_HOLD_ACTION_TYPES)[number];

export const RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Timeline sources are merged in memory from existing PR4-7 tables. There is
 * deliberately no timeline table and no SQL counterpart to this union.
 */
export const TIMELINE_SOURCES = [
  'system', 'manager', 'driver', 'attendance', 'notification', 'retention_hold',
] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

// ---------------------------------------------------------------------------
// Metric keys
// ---------------------------------------------------------------------------

export const PRESENCE_METRIC_KEYS = [
  'presence.scheduled_days',
  'presence.confirmed_days',
  'presence.unconfirmed_days',
  // Vehicle-only evidence is counted SEPARATELY and never rolls into
  // presence.confirmed_days: a vehicle at a site is not a person at a site.
  'presence.vehicle_only_days',
] as const;

export const INCIDENT_METRIC_KEYS = [
  'incident.late', 'incident.wrong_site', 'incident.evidence_mismatch', 'incident.left_early',
  'incident.unassigned', 'incident.unverifiable', 'incident.evidence_gap',
  'incident.vehicle_on_site_driver_unconfirmed', 'incident.accident_sos',
  'incident.dangerous_area_entry', 'incident.theft_after_hours_movement', 'incident.severe_driving',
  'incident.prolonged_unauthorized_stop', 'incident.lost_contact_moving',
] as const;

export const OUTCOME_METRIC_KEYS = [
  'outcome.confirmed', 'outcome.valid_reason', 'outcome.false_positive', 'outcome.data_gap',
  'outcome.assignment_error', 'outcome.geofence_error', 'outcome.duplicate',
  'outcome.no_action_required',
] as const;

export const TIMING_METRIC_KEYS = [
  'timing.acknowledgement', 'timing.review_start', 'timing.resolution', 'timing.driver_response',
] as const;

export const INPUT_METRIC_KEYS = [
  'input.requests_sent', 'input.responses_received', 'input.responses_on_time',
] as const;

export const RELIABILITY_METRIC_KEYS = [
  'reliability.monitor_runs_expected', 'reliability.monitor_runs_completed',
  'reliability.notifications_sent', 'reliability.notifications_delivered',
  'reliability.evidence_available', 'reliability.recurrence',
] as const;

export const OPERATIONS_METRIC_KEYS = [
  ...PRESENCE_METRIC_KEYS, ...INCIDENT_METRIC_KEYS, ...OUTCOME_METRIC_KEYS,
  ...TIMING_METRIC_KEYS, ...INPUT_METRIC_KEYS, ...RELIABILITY_METRIC_KEYS,
] as const;
export type OperationsMetricKey = (typeof OPERATIONS_METRIC_KEYS)[number];

/**
 * Fixed histogram bucket upper bounds in seconds. Storing bucket counts rather
 * than durations keeps a median estimable indefinitely without retaining any
 * individual's exact timing.
 */
export const DURATION_BUCKET_BOUNDS = [300, 900, 1800, 3600, 14400] as const;

export const DURATION_BUCKET_COLUMNS = [
  'bucket_0_300', 'bucket_301_900', 'bucket_901_1800',
  'bucket_1801_3600', 'bucket_3601_14400', 'bucket_over_14400',
] as const;
export type DurationBucketColumn = (typeof DURATION_BUCKET_COLUMNS)[number];

// ---------------------------------------------------------------------------
// The aggregate surface (INTERNAL - see the disclosure note before exposing it)
// ---------------------------------------------------------------------------

/**
 * The complete, ordered column list of `fleet_operational_monthly_aggregates`.
 *
 * This is an allow-list, not documentation. Both contract tests compare it to
 * the migration and to `information_schema`, so a column added to the aggregate
 * table without being added here fails the build — which is the point: an
 * aggregate is retained indefinitely, so a column that can hold identity must
 * never reach it in the first place.
 *
 * NOTE that this constrains the SHAPE of a row, not what can be inferred from a
 * SET of rows. No column here can hold a name; that does not make the table
 * safe to publish. See `.claude/modules/fleet-analytics-disclosure.md`.
 */
export const PUBLIC_AGGREGATE_COLUMNS = [
  'id', 'metric_version', 'month_start', 'dimension_level', 'dimension_project_id',
  'dimension_site_id', 'generalized_from_level', 'metric_key', 'metric_kind',
  'numerator', 'denominator', 'sample_count', 'sum_seconds',
  ...DURATION_BUCKET_COLUMNS,
  'contributor_count', 'is_active', 'aggregation_run_id', 'checksum', 'created_at', 'updated_at',
] as const;

/**
 * The columns migration 527's published view exposes — a strict subset of the
 * table's, and the actual public surface.
 *
 * Four kinds of column are missing, for three different reasons.
 *
 * `contributor_count` and the histogram columns are CHANNELS: a contributor
 * count differences across metric keys exactly as a numerator does, and
 * `sum_seconds` over one sample is one person's exact duration. They stay in the
 * table because the writer needs them and a median has to remain estimable after
 * the incident is purged; they are not published.
 *
 * `checksum` is absent because it RECONSTRUCTS them. `canonicalize` hashes a
 * fixed field order that includes all four, and every other field in that
 * preimage is published — so one unknown small integer stands between a reader
 * and the digest, and a few thousand hashes closes it. Dropping three columns
 * while publishing a fourth that gives them back is what a column list has to be
 * read as a whole to catch.
 *
 * `generalized_from_level` is absent for a different reason again: under the
 * tier rule its value is a function of the row's level, so it says nothing.
 *
 * The view also restricts ROWS, to organisation and project level. Site
 * aggregates are computed, stored, and never published.
 */
export const PUBLISHED_VIEW_COLUMNS = [
  'id', 'metric_version', 'month_start', 'dimension_level', 'dimension_project_id',
  'dimension_site_id', 'metric_key', 'metric_kind', 'numerator', 'denominator',
  'is_active', 'aggregation_run_id', 'created_at', 'updated_at',
] as const;

/** The dimension levels the published view exposes. Site is deliberately absent. */
export const PUBLISHED_DIMENSION_LEVELS = ['organisation', 'project'] as const;

/**
 * The metric kind a row must carry, mirroring the migration's
 * `histogram_pairing` CHECK: it makes `metric_key LIKE 'timing.%'` and
 * `metric_kind = 'duration_histogram'` the same condition, so the kind is a
 * function of the key and never a caller's choice. A non-timing metric is a
 * ratio when it has a denominator to divide by, and a plain count otherwise.
 */
export function metricKindFor(
  metricKey: OperationsMetricKey,
  denominator: number | null,
): AggregateMetricKind {
  if (metricKey.startsWith('timing.')) return 'duration_histogram';
  return denominator === null ? 'count' : 'ratio';
}

/**
 * Substrings that may not appear in an aggregate column name. Task 2's release
 * step reuses this to reject a forbidden key at serialization time as well.
 */
export const FORBIDDEN_AGGREGATE_COLUMN_TOKENS = [
  'staff', 'user', 'driver', 'vehicle', 'employee', 'person',
  'latitude', 'longitude', 'coord', 'geom', 'geog', 'point',
  'note', 'comment', 'remark', 'reason', 'description', 'prose',
  'filename', 'file_name', 'url', 'uri', 'storage', 'evidence',
  'email', 'phone', 'msisdn', 'address', 'name', 'title', 'registration',
] as const;

