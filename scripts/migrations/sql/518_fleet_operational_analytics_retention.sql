-- 518_fleet_operational_analytics_retention.sql
--
-- PR8: anonymous monthly aggregates that are retained indefinitely, beside a
-- retention pipeline that purges identifiable PR4-7 incident data after the
-- configured period. No person is seeded here.
--
-- Two invariants are enforced by this schema rather than by the services that
-- will use it, because the data is disciplinary information about named
-- drivers and a service can be bypassed by a stray query:
--
--   1. A public aggregate is INCAPABLE of carrying identity. Every text column
--      on fleet_operational_monthly_aggregates is pinned to a closed value set
--      or a shape, the table has no foreign key to any person/vehicle/incident
--      table, and no group smaller than five contributors can be stored at all.
--
--   2. Retention CANNOT delete an incident that is still active or on hold.
--      trg_fleet_incident_purge_guard refuses the DELETE outright, so the
--      guarantee holds for psql as much as for the purge service.
--
-- Both guards raise SQLSTATE 23514 (check_violation) so that callers already
-- handling constraint violations treat them uniformly.

-- ---------------------------------------------------------------------------
-- Effective settings. Versioned with an open-ended current row, mirroring
-- fleet_incident_driver_input_settings from 511.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_operational_analytics_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  retention_months INTEGER NOT NULL DEFAULT 12,
  anonymity_min_contributors INTEGER NOT NULL DEFAULT 5,
  recalculation_window_months INTEGER NOT NULL DEFAULT 3,
  retention_batch_size INTEGER NOT NULL DEFAULT 100,
  maximum_hold_review_days INTEGER NOT NULL DEFAULT 90,
  hold_review_reminder_lead_days INTEGER NOT NULL DEFAULT 14,
  aggregation_run_hour_sast INTEGER NOT NULL DEFAULT 1,
  aggregation_run_minute_sast INTEGER NOT NULL DEFAULT 0,
  retention_run_hour_sast INTEGER NOT NULL DEFAULT 3,
  retention_run_minute_sast INTEGER NOT NULL DEFAULT 30,
  aggregate_freshness_warning_hours INTEGER NOT NULL DEFAULT 36,
  retention_freshness_warning_hours INTEGER NOT NULL DEFAULT 48,
  permitted_hold_categories TEXT[] NOT NULL
    DEFAULT ARRAY['health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved']::text[],
  metric_version INTEGER NOT NULL DEFAULT 1,
  -- The scheduled wrapper runs dry until this is explicitly turned on in
  -- production. Deletion never starts by default.
  live_retention_enabled BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_analytics_settings_version_positive CHECK (version > 0),
  CONSTRAINT fleet_operational_analytics_settings_range_order
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fleet_operational_analytics_settings_retention_months
    CHECK (retention_months BETWEEN 1 AND 120),
  -- Five is the floor, not the default: a settings row cannot weaken the
  -- anonymity threshold below what the aggregate table itself enforces.
  CONSTRAINT fleet_operational_analytics_settings_anonymity_floor
    CHECK (anonymity_min_contributors >= 5),
  CONSTRAINT fleet_operational_analytics_settings_window_positive
    CHECK (recalculation_window_months BETWEEN 1 AND 24),
  CONSTRAINT fleet_operational_analytics_settings_batch_bounded
    CHECK (retention_batch_size BETWEEN 1 AND 100),
  CONSTRAINT fleet_operational_analytics_settings_review_days
    CHECK (maximum_hold_review_days BETWEEN 1 AND 90),
  CONSTRAINT fleet_operational_analytics_settings_reminder_lead
    CHECK (hold_review_reminder_lead_days BETWEEN 1 AND maximum_hold_review_days),
  CONSTRAINT fleet_operational_analytics_settings_schedule_bounds CHECK (
    aggregation_run_hour_sast BETWEEN 0 AND 23 AND aggregation_run_minute_sast BETWEEN 0 AND 59
    AND retention_run_hour_sast BETWEEN 0 AND 23 AND retention_run_minute_sast BETWEEN 0 AND 59
  ),
  CONSTRAINT fleet_operational_analytics_settings_freshness_positive CHECK (
    aggregate_freshness_warning_hours > 0 AND retention_freshness_warning_hours > 0
  ),
  CONSTRAINT fleet_operational_analytics_settings_metric_version CHECK (metric_version > 0),
  CONSTRAINT fleet_operational_analytics_settings_hold_categories CHECK (
    array_length(permitted_hold_categories, 1) >= 1
    AND permitted_hold_categories <@ ARRAY[
      'health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved']::text[]
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_analytics_settings_open
  ON fleet_operational_analytics_settings ((true)) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_analytics_settings_version
  ON fleet_operational_analytics_settings (version);

-- ---------------------------------------------------------------------------
-- Aggregation run health.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_operational_aggregation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  trigger_source TEXT NOT NULL DEFAULT 'cron',
  metric_version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  months_requested INTEGER NOT NULL DEFAULT 0,
  months_succeeded INTEGER NOT NULL DEFAULT 0,
  months_failed INTEGER NOT NULL DEFAULT 0,
  rows_written BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_aggregation_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  CONSTRAINT fleet_operational_aggregation_runs_trigger_check
    CHECK (trigger_source IN ('cron', 'manual')),
  CONSTRAINT fleet_operational_aggregation_runs_finish_pairing
    CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT fleet_operational_aggregation_runs_counts_nonnegative CHECK (
    months_requested >= 0 AND months_succeeded >= 0 AND months_failed >= 0 AND rows_written >= 0
    AND months_succeeded + months_failed <= months_requested
  )
);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_aggregation_runs_started
  ON fleet_operational_aggregation_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- INVARIANT 1. The public monthly aggregate.
--
-- The column list here is the whole surface, and it is deliberately hostile to
-- growth: src/modules/fleet/incidents/analytics/aggregateSchema.ts pins it and
-- both contract tests fail if a column is added on either side. A column that
-- could hold identity does not belong in this table at all -- there is no
-- "just this once", because these rows outlive every purge.
--
-- dimension_project_id / dimension_site_id are organisational units, not
-- people, and they are the dimensions the suppression rules generalize along.
-- There is no staff, user, driver, vehicle, incident, coordinate, prose,
-- filename, URL, or evidence column, and no foreign key that leads to one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_operational_monthly_aggregates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_version INTEGER NOT NULL,
  month_start DATE NOT NULL,
  dimension_level TEXT NOT NULL,
  dimension_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  dimension_site_id UUID REFERENCES fleet_project_operational_sites(id) ON DELETE SET NULL,
  generalized_from_level TEXT,
  metric_key TEXT NOT NULL,
  metric_kind TEXT NOT NULL,
  numerator BIGINT NOT NULL DEFAULT 0,
  denominator BIGINT,
  sample_count BIGINT,
  sum_seconds BIGINT,
  bucket_0_300 BIGINT,
  bucket_301_900 BIGINT,
  bucket_901_1800 BIGINT,
  bucket_1801_3600 BIGINT,
  bucket_3601_14400 BIGINT,
  bucket_over_14400 BIGINT,
  contributor_count INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  aggregation_run_id UUID REFERENCES fleet_operational_aggregation_runs(id) ON DELETE SET NULL,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_monthly_aggregates_dimension_level_check
    CHECK (dimension_level IN ('site', 'project', 'organisation')),
  CONSTRAINT fleet_operational_monthly_aggregates_generalized_check
    CHECK (generalized_from_level IS NULL OR generalized_from_level IN ('site', 'project', 'organisation')),
  CONSTRAINT fleet_operational_monthly_aggregates_metric_kind_check
    CHECK (metric_kind IN ('count', 'ratio', 'duration_histogram')),
  CONSTRAINT fleet_operational_monthly_aggregates_metric_key_check CHECK (metric_key IN (
    'presence.scheduled_days', 'presence.confirmed_days', 'presence.unconfirmed_days',
    'presence.vehicle_only_days',
    'incident.late', 'incident.wrong_site', 'incident.evidence_mismatch', 'incident.left_early',
    'incident.unassigned', 'incident.unverifiable', 'incident.evidence_gap',
    'incident.vehicle_on_site_driver_unconfirmed', 'incident.accident_sos',
    'incident.dangerous_area_entry', 'incident.theft_after_hours_movement', 'incident.severe_driving',
    'incident.prolonged_unauthorized_stop', 'incident.lost_contact_moving',
    'outcome.confirmed', 'outcome.valid_reason', 'outcome.false_positive', 'outcome.data_gap',
    'outcome.assignment_error', 'outcome.geofence_error', 'outcome.duplicate',
    'outcome.no_action_required',
    'timing.acknowledgement', 'timing.review_start', 'timing.resolution', 'timing.driver_response',
    'input.requests_sent', 'input.responses_received', 'input.responses_on_time',
    'reliability.monitor_runs_expected', 'reliability.monitor_runs_completed',
    'reliability.notifications_sent', 'reliability.notifications_delivered',
    'reliability.evidence_available', 'reliability.recurrence'
  )),
  -- No exact date, and therefore no exact timestamp, can be stored: the month
  -- is the finest granularity this table can express.
  CONSTRAINT fleet_operational_monthly_aggregates_month_start_check
    CHECK (EXTRACT(DAY FROM month_start) = 1),
  CONSTRAINT fleet_operational_monthly_aggregates_dimension_pairing CHECK (
    (dimension_level = 'organisation' AND dimension_project_id IS NULL AND dimension_site_id IS NULL)
    OR (dimension_level = 'project' AND dimension_project_id IS NOT NULL AND dimension_site_id IS NULL)
    OR (dimension_level = 'site' AND dimension_project_id IS NOT NULL AND dimension_site_id IS NOT NULL)
  ),
  -- Histogram columns exist for the timing metrics and for nothing else, so a
  -- non-timing row cannot carry a duration at all.
  --
  -- NOTE (2026-08-23, PR #2594, comment only - this migration is applied and
  -- its DDL is unchanged). The sentence above is true and narrow: it is about
  -- NON-timing rows, and the constraint does force sum_seconds NULL for them.
  -- It is worth reading carefully, because it is easy to take for a stronger
  -- guarantee than it makes. A TIMING row with sample_count = 1 has a
  -- sum_seconds that IS one person's exact duration, and no constraint here can
  -- prevent that - the row is perfectly well-formed. It is prevented in the
  -- calculator, which withholds any metric whose support is below the anonymity
  -- threshold. See .claude/modules/fleet-analytics-disclosure.md.
  CONSTRAINT fleet_operational_monthly_aggregates_histogram_pairing CHECK (
    (metric_key LIKE 'timing.%') = (metric_kind = 'duration_histogram')
    AND (
      (metric_kind = 'duration_histogram'
        AND sample_count IS NOT NULL AND sum_seconds IS NOT NULL
        AND bucket_0_300 IS NOT NULL AND bucket_301_900 IS NOT NULL AND bucket_901_1800 IS NOT NULL
        AND bucket_1801_3600 IS NOT NULL AND bucket_3601_14400 IS NOT NULL
        AND bucket_over_14400 IS NOT NULL)
      OR (metric_kind <> 'duration_histogram'
        AND sample_count IS NULL AND sum_seconds IS NULL
        AND bucket_0_300 IS NULL AND bucket_301_900 IS NULL AND bucket_901_1800 IS NULL
        AND bucket_1801_3600 IS NULL AND bucket_3601_14400 IS NULL AND bucket_over_14400 IS NULL)
    )
  ),
  CONSTRAINT fleet_operational_monthly_aggregates_counts_nonnegative CHECK (
    numerator >= 0 AND (denominator IS NULL OR denominator >= 0)
    AND (sample_count IS NULL OR sample_count >= 0) AND (sum_seconds IS NULL OR sum_seconds >= 0)
    AND (denominator IS NULL OR numerator <= denominator)
  ),
  -- k-anonymity as a table constraint. A group of four cannot be stored, so it
  -- cannot later leak through a query bug: suppression happens before the row
  -- exists, or the row does not exist.
  CONSTRAINT fleet_operational_monthly_aggregates_contributor_floor
    CHECK (contributor_count >= 5),
  CONSTRAINT fleet_operational_monthly_aggregates_metric_version_check CHECK (metric_version > 0),
  -- A shape guard, not a value guard: only a lowercase sha256 hex digest fits,
  -- so this column cannot be repurposed to carry a note, a filename, or a URL.
  CONSTRAINT fleet_operational_monthly_aggregates_checksum_shape
    CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$')
);
-- COALESCE rather than a bare column list: the organisation-level rows carry
-- NULL project and site, and NULLs compare as distinct in a unique index, so a
-- naive index would let duplicate organisation rows through.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_monthly_aggregates_slot
  ON fleet_operational_monthly_aggregates (
    metric_version, month_start, dimension_level,
    COALESCE(dimension_project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(dimension_site_id, '00000000-0000-0000-0000-000000000000'::uuid),
    metric_key
  );
CREATE INDEX IF NOT EXISTS ix_fleet_operational_monthly_aggregates_lookup
  ON fleet_operational_monthly_aggregates (month_start, metric_key, dimension_level)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- Retention holds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_incident_retention_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE, not RESTRICT: a legitimately purged incident takes its released
  -- holds with it. Active holds are stopped by trg_fleet_incident_purge_guard
  -- below, which runs BEFORE the cascade.
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hold_start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_review_at TIMESTAMPTZ NOT NULL,
  last_reviewed_at TIMESTAMPTZ,
  last_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id) ON DELETE SET NULL,
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_incident_retention_holds_category_check CHECK (category IN (
    'health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved'
  )),
  CONSTRAINT fleet_incident_retention_holds_status_check CHECK (status IN ('active', 'released')),
  CONSTRAINT fleet_incident_retention_holds_reason_nonblank
    CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  -- An indefinite hold is how identifiable data quietly becomes permanent. The
  -- next review is always in the future and never more than 90 days out from
  -- the last time a human looked at it.
  CONSTRAINT fleet_incident_retention_holds_review_window CHECK (
    next_review_at > COALESCE(last_reviewed_at, hold_start_at)
    AND next_review_at <= COALESCE(last_reviewed_at, hold_start_at) + INTERVAL '90 days'
  ),
  CONSTRAINT fleet_incident_retention_holds_review_pairing
    CHECK ((last_reviewed_at IS NULL) = (last_reviewed_by IS NULL)),
  CONSTRAINT fleet_incident_retention_holds_release_pairing CHECK (
    (status = 'active' AND released_at IS NULL AND released_by IS NULL AND release_reason IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND released_by IS NOT NULL
      AND NULLIF(btrim(release_reason), '') IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_incident_retention_holds_active
  ON fleet_incident_retention_holds (incident_id, category) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_fleet_incident_retention_holds_due
  ON fleet_incident_retention_holds (next_review_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS fleet_incident_retention_hold_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id UUID NOT NULL REFERENCES fleet_incident_retention_holds(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  previous_next_review_at TIMESTAMPTZ,
  new_next_review_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_incident_retention_hold_actions_type_check CHECK (action_type IN (
    'created', 'reviewed', 'extended', 'released'
  )),
  CONSTRAINT fleet_incident_retention_hold_actions_note_nonblank
    CHECK (note IS NULL OR NULLIF(btrim(note), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_fleet_incident_retention_hold_actions_hold
  ON fleet_incident_retention_hold_actions (hold_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Retention runs and per-item stages.
--
-- Run totals are counts only. There is no incident, staff, project, or vehicle
-- reference on the run itself, so a run record retained for audit does not
-- become a list of who was investigated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_operational_retention_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  dry_run BOOLEAN NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'cron',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  cutoff_work_date DATE NOT NULL,
  policy_months INTEGER NOT NULL,
  items_considered INTEGER NOT NULL DEFAULT 0,
  items_claimed INTEGER NOT NULL DEFAULT 0,
  items_completed INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  items_skipped_hold INTEGER NOT NULL DEFAULT 0,
  items_skipped_coverage INTEGER NOT NULL DEFAULT 0,
  storage_objects_deleted INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_retention_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  CONSTRAINT fleet_operational_retention_runs_trigger_check
    CHECK (trigger_source IN ('cron', 'manual')),
  CONSTRAINT fleet_operational_retention_runs_finish_pairing
    CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT fleet_operational_retention_runs_policy_months CHECK (policy_months BETWEEN 1 AND 120),
  CONSTRAINT fleet_operational_retention_runs_counts_nonnegative CHECK (
    items_considered >= 0 AND items_claimed >= 0 AND items_completed >= 0 AND items_failed >= 0
    AND items_skipped_hold >= 0 AND items_skipped_coverage >= 0 AND storage_objects_deleted >= 0
  ),
  -- A dry run reports and never deletes.
  CONSTRAINT fleet_operational_retention_runs_dry_run_deletes_nothing CHECK (
    NOT dry_run OR (items_claimed = 0 AND items_completed = 0 AND storage_objects_deleted = 0)
  )
);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_retention_runs_started
  ON fleet_operational_retention_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS fleet_operational_retention_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retention_run_id UUID NOT NULL REFERENCES fleet_operational_retention_runs(id) ON DELETE RESTRICT,
  -- SET NULL, not CASCADE: the item survives the purge as a non-identifying
  -- audit record of the deletion, with the identity cleared.
  incident_id UUID REFERENCES fleet_operational_incidents(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'claimed',
  storage_objects_total INTEGER NOT NULL DEFAULT 0,
  storage_objects_deleted INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_retention_items_stage_check CHECK (stage IN (
    'claimed', 'pending_storage', 'storage_complete', 'database_complete', 'failed'
  )),
  CONSTRAINT fleet_operational_retention_items_counts_nonnegative CHECK (
    storage_objects_total >= 0 AND attempts >= 0
    AND storage_objects_deleted BETWEEN 0 AND storage_objects_total
  ),
  -- Reaching database_complete means the incident row is gone and every
  -- storage object was accounted for. Nothing can claim completion while it
  -- still holds an identity or an undeleted attachment.
  CONSTRAINT fleet_operational_retention_items_complete_pairing CHECK (
    stage <> 'database_complete'
    OR (incident_id IS NULL AND storage_objects_deleted = storage_objects_total
      AND completed_at IS NOT NULL)
  ),
  CONSTRAINT fleet_operational_retention_items_storage_stage_pairing CHECK (
    stage NOT IN ('storage_complete', 'database_complete')
    OR storage_objects_deleted = storage_objects_total
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_retention_items_live
  ON fleet_operational_retention_items (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fleet_operational_retention_items_run_stage
  ON fleet_operational_retention_items (retention_run_id, stage);

-- ---------------------------------------------------------------------------
-- INVARIANT 2. Nothing active or held can be deleted.
--
-- Race note: a hold raised concurrently with a purge serialises against it
-- WITHOUT any application-level locking. Inserting into
-- fleet_incident_retention_holds takes an implicit FOR KEY SHARE lock on the
-- referenced fleet_operational_incidents row as part of the FK check, and that
-- conflicts with the row lock a concurrent DELETE needs. Either the hold
-- commits first and this trigger then refuses the delete, or the delete
-- commits first and the hold insert fails with a foreign-key violation. There
-- is no interleaving in which an active hold is deleted out from under itself,
-- and no orphaned hold.
--
-- Verified empirically against PostgreSQL 15, not assumed: a DELETE held
-- uncommitted on the parent row blocks a concurrent child INSERT with
-- "canceling statement due to lock timeout ... while locking tuple in relation".
-- Do NOT remove the FK in favour of a soft reference; the FK is load-bearing
-- for this guarantee, not merely for referential tidiness.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fleet_assert_incident_purgeable(target_incident_id UUID)
RETURNS void AS $$
DECLARE
  incident_lifecycle TEXT;
BEGIN
  SELECT lifecycle_status INTO incident_lifecycle
    FROM fleet_operational_incidents WHERE id = target_incident_id;
  IF incident_lifecycle IS NULL THEN
    RETURN;
  END IF;
  IF incident_lifecycle NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION
      'fleet retention: incident % is not in a terminal state (%) and cannot be purged',
      target_incident_id, incident_lifecycle
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM fleet_incident_retention_holds
     WHERE incident_id = target_incident_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION
      'fleet retention: incident % is under an active retention hold and cannot be purged',
      target_incident_id
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fleet_incident_purge_guard()
RETURNS trigger AS $$
BEGIN
  PERFORM fleet_assert_incident_purgeable(OLD.id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_incident_purge_guard ON fleet_operational_incidents;
CREATE TRIGGER trg_fleet_incident_purge_guard
  BEFORE DELETE ON fleet_operational_incidents
  FOR EACH ROW EXECUTE FUNCTION fleet_incident_purge_guard();

-- The same guard on the way in, so an ineligible incident cannot even be
-- claimed, and a hold raised mid-run blocks the next stage advance.
CREATE OR REPLACE FUNCTION fleet_retention_item_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.incident_id IS NOT NULL THEN
    PERFORM fleet_assert_incident_purgeable(NEW.incident_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_retention_item_guard ON fleet_operational_retention_items;
CREATE TRIGGER trg_fleet_retention_item_guard
  BEFORE INSERT OR UPDATE ON fleet_operational_retention_items
  FOR EACH ROW EXECUTE FUNCTION fleet_retention_item_guard();

-- Hold history is evidence about a decision to keep someone's data. It may be
-- appended to and never rewritten. DELETE is left to the ON DELETE CASCADE from
-- a legitimately purged incident, which invariant 2 already gates.
CREATE OR REPLACE FUNCTION fleet_hold_action_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fleet retention: hold actions are append-only and cannot be updated'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_hold_action_append_only ON fleet_incident_retention_hold_actions;
CREATE TRIGGER trg_fleet_hold_action_append_only
  BEFORE UPDATE ON fleet_incident_retention_hold_actions
  FOR EACH ROW EXECUTE FUNCTION fleet_hold_action_append_only();

-- ---------------------------------------------------------------------------
-- Grants. Mirrors 510/511: no DELETE on the aggregate or audit tables, and the
-- application never gets DELETE on hold history.
-- ---------------------------------------------------------------------------
REVOKE ALL ON fleet_operational_analytics_settings, fleet_operational_aggregation_runs,
  fleet_operational_monthly_aggregates, fleet_incident_retention_holds,
  fleet_incident_retention_hold_actions, fleet_operational_retention_runs,
  fleet_operational_retention_items FROM fibreflow_user;
GRANT SELECT, INSERT, UPDATE ON fleet_operational_analytics_settings,
  fleet_operational_aggregation_runs, fleet_incident_retention_holds,
  fleet_operational_retention_runs, fleet_operational_retention_items TO fibreflow_user;
GRANT SELECT, INSERT ON fleet_incident_retention_hold_actions TO fibreflow_user;
-- Monthly aggregates are versioned by replacement: a month/version is deleted
-- and rewritten atomically, so this one needs DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_operational_monthly_aggregates TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- Seeds. Idempotent, and no user, email, or staff row is created.
-- ---------------------------------------------------------------------------
INSERT INTO fleet_operational_analytics_settings (version, effective_from)
SELECT 1, now()
 WHERE NOT EXISTS (SELECT 1 FROM fleet_operational_analytics_settings);

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'fleet.retention-holds', 'fleet', 'Incident Retention Holds',
   'Raise, review, and release retention holds on Fleet operational incidents', '/fleet/incidents', 27, true)
ON CONFLICT (key) DO NOTHING;
-- Deliberately NOT granted to manager or project_manager. A PM sees a hold on
-- an incident in their own project through fleet.incidents; placing one is a
-- decision to keep a named person's disciplinary record beyond the standard
-- period, and that stays an admin act.
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.retention-holds', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb),
  ('admin', 'fleet.retention-holds', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
