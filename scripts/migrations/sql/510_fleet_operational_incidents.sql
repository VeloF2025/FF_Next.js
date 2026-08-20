-- 510_fleet_operational_incidents.sql
-- Durable, reviewable Fleet operational incidents. No person is seeded here.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS fleet_operational_incident_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  creates_incident BOOLEAN NOT NULL DEFAULT true,
  severity TEXT NOT NULL,
  immediate_notification BOOLEAN NOT NULL DEFAULT false,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  include_in_morning_summary BOOLEAN NOT NULL DEFAULT false,
  acknowledgement_target_minutes INTEGER NOT NULL,
  reminder_interval_minutes INTEGER NOT NULL DEFAULT 15,
  maximum_escalation_level INTEGER NOT NULL DEFAULT 3,
  evidence_required_outcomes TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_incident_rules_type_check CHECK (incident_type IN (
    'late', 'wrong_site', 'evidence_mismatch', 'left_early',
    'unassigned', 'unverifiable', 'evidence_gap', 'vehicle_on_site_driver_unconfirmed',
    'accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement', 'severe_driving',
    'prolonged_unauthorized_stop', 'lost_contact_moving'
  )),
  CONSTRAINT fleet_operational_incident_rules_version_positive CHECK (version > 0),
  CONSTRAINT fleet_operational_incident_rules_range_order CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fleet_operational_incident_rules_severity_check CHECK (severity IN ('normal', 'high', 'critical')),
  CONSTRAINT fleet_operational_incident_rules_timing_check CHECK (
    acknowledgement_target_minutes > 0 AND reminder_interval_minutes > 0 AND maximum_escalation_level >= 0
  ),
  CONSTRAINT fleet_operational_incident_rules_reason_nonblank CHECK (change_reason IS NULL OR btrim(change_reason) <> ''),
  CONSTRAINT fleet_operational_incident_rules_outcomes_check CHECK (
    evidence_required_outcomes <@ ARRAY[
      'confirmed', 'valid_reason', 'false_positive', 'data_gap',
      'assignment_error', 'geofence_error', 'duplicate', 'no_action_required'
    ]::text[]
  ),
  CONSTRAINT fleet_operational_incident_rules_type_version_unique UNIQUE (incident_type, version)
);
ALTER TABLE fleet_operational_incident_rules
  ADD CONSTRAINT fleet_operational_incident_rules_no_overlap
  EXCLUDE USING gist (
    incident_type WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_incident_rules_open_type ON fleet_operational_incident_rules (incident_type) WHERE effective_to IS NULL;
CREATE TABLE IF NOT EXISTS fleet_operational_oversight_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ended_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_oversight_members_range_order CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fleet_operational_oversight_members_reason_nonblank CHECK (reason IS NULL OR btrim(reason) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_oversight_members_active_user ON fleet_operational_oversight_members (user_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_fleet_operational_oversight_members_effective ON fleet_operational_oversight_members (effective_from, effective_to);
CREATE TABLE IF NOT EXISTS fleet_operational_monitor_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_kind TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  roster_evaluated_count INTEGER NOT NULL DEFAULT 0,
  incidents_opened_count INTEGER NOT NULL DEFAULT 0,
  incidents_updated_count INTEGER NOT NULL DEFAULT 0,
  incidents_cleared_count INTEGER NOT NULL DEFAULT 0,
  notifications_accepted_count INTEGER NOT NULL DEFAULT 0,
  notifications_failed_count INTEGER NOT NULL DEFAULT 0,
  summaries_sent_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_monitor_runs_kind_check CHECK (run_kind IN ('status_monitor', 'escalation', 'morning_summary')),
  CONSTRAINT fleet_operational_monitor_runs_status_check CHECK (status IN ('running', 'succeeded', 'partial_failure', 'failed')),
  CONSTRAINT fleet_operational_monitor_runs_counts_check CHECK (
    roster_evaluated_count >= 0 AND incidents_opened_count >= 0 AND incidents_updated_count >= 0
    AND incidents_cleared_count >= 0 AND notifications_accepted_count >= 0
    AND notifications_failed_count >= 0 AND summaries_sent_count >= 0 AND error_count >= 0
  ),
  CONSTRAINT fleet_operational_monitor_runs_completion_check CHECK (
    (status = 'running' AND completed_at IS NULL) OR (status <> 'running' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT fleet_operational_monitor_runs_error_nonblank CHECK (error_summary IS NULL OR btrim(error_summary) <> '')
);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_monitor_runs_kind_started ON fleet_operational_monitor_runs (run_kind, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_monitor_runs_status_started ON fleet_operational_monitor_runs (status, started_at DESC);
CREATE TABLE IF NOT EXISTS fleet_operational_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_reference TEXT NOT NULL UNIQUE,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'open',
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  operational_site_id UUID REFERENCES fleet_project_operational_sites(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
  operational_assignment_id UUID REFERENCES fleet_operational_assignments(id) ON DELETE SET NULL,
  work_date DATE,
  staff_name_snapshot TEXT,
  project_name_snapshot TEXT,
  operational_site_name_snapshot TEXT,
  vehicle_registration_snapshot TEXT,
  source_event_id TEXT,
  status_rule_id UUID REFERENCES fleet_operational_status_rules(id) ON DELETE SET NULL,
  status_rule_version INTEGER,
  incident_rule_id UUID REFERENCES fleet_operational_incident_rules(id) ON DELETE SET NULL,
  incident_rule_version INTEGER,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  condition_last_seen_at TIMESTAMPTZ,
  condition_cleared_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ,
  review_started_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  review_started_at TIMESTAMPTZ,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  last_escalated_at TIMESTAMPTZ,
  next_escalation_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  outcome TEXT,
  resolution_note TEXT,
  duplicate_incident_id UUID REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  linked_hs_reference TEXT,
  linked_maintenance_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_incidents_type_check CHECK (incident_type IN (
    'late', 'wrong_site', 'evidence_mismatch', 'left_early',
    'unassigned', 'unverifiable', 'evidence_gap', 'vehicle_on_site_driver_unconfirmed',
    'accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement', 'severe_driving',
    'prolonged_unauthorized_stop', 'lost_contact_moving'
  )),
  CONSTRAINT fleet_operational_incidents_severity_check CHECK (severity IN ('normal', 'high', 'critical')),
  CONSTRAINT fleet_operational_incidents_lifecycle_check CHECK (lifecycle_status IN ('open', 'acknowledged', 'under_review', 'resolved', 'dismissed')),
  CONSTRAINT fleet_operational_incidents_outcome_check CHECK (outcome IS NULL OR outcome IN (
    'confirmed', 'valid_reason', 'false_positive', 'data_gap',
    'assignment_error', 'geofence_error', 'duplicate', 'no_action_required'
  )),
  CONSTRAINT fleet_operational_incidents_evidence_snapshot_object CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  CONSTRAINT fleet_operational_incidents_escalation_nonnegative CHECK (escalation_level >= 0),
  CONSTRAINT fleet_operational_incidents_status_rule_pair_check CHECK ((status_rule_id IS NULL) = (status_rule_version IS NULL) AND (status_rule_version IS NULL OR status_rule_version > 0)),
  CONSTRAINT fleet_operational_incidents_incident_rule_pair_check CHECK ((incident_rule_id IS NULL) = (incident_rule_version IS NULL) AND (incident_rule_version IS NULL OR incident_rule_version > 0)),
  CONSTRAINT fleet_operational_incidents_lifecycle_details_check CHECK (
    (lifecycle_status = 'open' AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND review_started_by IS NULL
      AND review_started_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL AND outcome IS NULL AND resolution_note IS NULL)
    OR (lifecycle_status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL
      AND review_started_by IS NULL AND review_started_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL AND outcome IS NULL AND resolution_note IS NULL)
    OR (lifecycle_status = 'under_review' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL
      AND review_started_by IS NOT NULL AND review_started_at IS NOT NULL AND resolved_by IS NULL AND resolved_at IS NULL AND outcome IS NULL AND resolution_note IS NULL)
    OR (lifecycle_status IN ('resolved', 'dismissed') AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL
      AND review_started_by IS NOT NULL AND review_started_at IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      AND outcome IS NOT NULL AND NULLIF(btrim(resolution_note), '') IS NOT NULL)
  ),
  CONSTRAINT fleet_operational_incidents_terminal_outcome_check CHECK (
    lifecycle_status NOT IN ('resolved', 'dismissed')
    OR (lifecycle_status = 'dismissed' AND outcome IN ('false_positive', 'data_gap', 'duplicate'))
    OR (lifecycle_status = 'resolved' AND outcome IN ('confirmed', 'valid_reason', 'assignment_error', 'geofence_error', 'no_action_required'))
  ),
  CONSTRAINT fleet_operational_incidents_duplicate_link_check CHECK (
    (outcome = 'duplicate' AND duplicate_incident_id IS NOT NULL AND duplicate_incident_id <> id)
    OR (outcome IS DISTINCT FROM 'duplicate' AND duplicate_incident_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_incidents_active_assignment
  ON fleet_operational_incidents (
    staff_id,
    incident_type,
    work_date,
    COALESCE(operational_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE lifecycle_status IN ('open', 'acknowledged', 'under_review');
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_incidents_source_event ON fleet_operational_incidents (incident_type, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incidents_queue ON fleet_operational_incidents (lifecycle_status, severity, opened_at DESC);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incidents_project_queue ON fleet_operational_incidents (project_id, lifecycle_status, opened_at DESC);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incidents_escalation ON fleet_operational_incidents (next_escalation_at) WHERE lifecycle_status = 'open' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incidents_staff_work_date ON fleet_operational_incidents (staff_id, work_date DESC);
-- The queue defaults to no filters, so listIncidents issues a bare COUNT(*) plus
-- `ORDER BY opened_at DESC`; every composite index above leads with another column.
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incidents_opened_at ON fleet_operational_incidents (opened_at DESC);
CREATE TABLE IF NOT EXISTS fleet_operational_incident_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  observation_fingerprint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  primary_status TEXT,
  flags TEXT[] NOT NULL DEFAULT '{}'::text[],
  rule_id UUID REFERENCES fleet_operational_status_rules(id) ON DELETE SET NULL,
  rule_version INTEGER,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  monitor_run_id UUID REFERENCES fleet_operational_monitor_runs(id) ON DELETE SET NULL,
  source_event_id TEXT,
  CONSTRAINT fleet_operational_incident_observations_fingerprint_nonblank CHECK (btrim(observation_fingerprint) <> ''),
  CONSTRAINT fleet_operational_incident_observations_evidence_snapshot_obj CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  CONSTRAINT fleet_operational_incident_observations_rule_pair_check CHECK ((rule_id IS NULL) = (rule_version IS NULL) AND (rule_version IS NULL OR rule_version > 0)),
  CONSTRAINT fleet_operational_incident_observations_fingerprint_unique UNIQUE (incident_id, observation_fingerprint)
);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incident_observations_incident_observed ON fleet_operational_incident_observations (incident_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS fleet_operational_incident_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  is_system_actor BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  before_lifecycle_status TEXT,
  after_lifecycle_status TEXT,
  before_escalation_level INTEGER,
  after_escalation_level INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_correlation_id TEXT,
  CONSTRAINT fleet_operational_incident_actions_type_check CHECK (action_type IN (
    'opened', 'acknowledged', 'review_started', 'commented', 'escalated',
    'condition_cleared', 'resolved', 'dismissed', 'evidence_added', 'recipient_changed'
  )),
  CONSTRAINT fleet_operational_incident_actions_actor_check CHECK ((actor_user_id IS NOT NULL) <> is_system_actor),
  CONSTRAINT fleet_operational_incident_actions_note_check CHECK (
    action_type NOT IN ('commented', 'resolved', 'dismissed') OR NULLIF(btrim(note), '') IS NOT NULL
  ),
  CONSTRAINT fleet_operational_incident_actions_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT fleet_operational_incident_actions_escalation_nonnegative CHECK (
    (before_escalation_level IS NULL OR before_escalation_level >= 0)
    AND (after_escalation_level IS NULL OR after_escalation_level >= 0)
  )
);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incident_actions_incident_occurred ON fleet_operational_incident_actions (incident_id, occurred_at DESC);
CREATE TABLE IF NOT EXISTS fleet_operational_incident_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  storage_url TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  mime_type TEXT,
  original_filename TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_incident_evidence_type_check CHECK (evidence_type IN ('photo', 'document', 'manager_note', 'external_reference')),
  CONSTRAINT fleet_operational_incident_evidence_storage_nonblank CHECK (btrim(storage_url) <> '' AND btrim(storage_key) <> ''),
  CONSTRAINT fleet_operational_incident_evidence_filename_nonblank CHECK (original_filename IS NULL OR btrim(original_filename) <> '')
);
CREATE INDEX IF NOT EXISTS ix_fleet_operational_incident_evidence_incident_created ON fleet_operational_incident_evidence (incident_id, created_at DESC);
REVOKE ALL ON fleet_operational_incident_rules, fleet_operational_oversight_members,
  fleet_operational_monitor_runs, fleet_operational_incidents,
  fleet_operational_incident_observations, fleet_operational_incident_actions,
  fleet_operational_incident_evidence FROM fibreflow_user;
GRANT SELECT, INSERT, UPDATE ON fleet_operational_incident_rules,
  fleet_operational_oversight_members, fleet_operational_monitor_runs,
  fleet_operational_incidents TO fibreflow_user;
GRANT SELECT, INSERT ON fleet_operational_incident_observations,
  fleet_operational_incident_actions, fleet_operational_incident_evidence TO fibreflow_user;
INSERT INTO fleet_operational_incident_rules (
  incident_type, version, effective_from, creates_incident, severity, immediate_notification,
  in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
  acknowledgement_target_minutes
) VALUES
  ('late', 1, now(), true, 'high', true, true, true, false, false, 15),
  ('wrong_site', 1, now(), true, 'high', true, true, true, false, false, 15),
  ('evidence_mismatch', 1, now(), true, 'high', true, true, true, false, false, 15),
  ('left_early', 1, now(), true, 'high', true, true, true, false, false, 15),
  ('unassigned', 1, now(), false, 'normal', false, true, true, false, true, 30),
  ('unverifiable', 1, now(), false, 'normal', false, true, true, false, true, 30),
  ('evidence_gap', 1, now(), false, 'normal', false, true, true, false, true, 30),
  ('vehicle_on_site_driver_unconfirmed', 1, now(), false, 'normal', false, true, true, false, true, 30),
  ('accident_sos', 1, now(), true, 'critical', true, true, true, true, false, 5),
  ('dangerous_area_entry', 1, now(), true, 'critical', true, true, true, true, false, 5),
  ('theft_after_hours_movement', 1, now(), true, 'critical', true, true, true, true, false, 5),
  ('severe_driving', 1, now(), true, 'critical', true, true, true, true, false, 5),
  ('prolonged_unauthorized_stop', 1, now(), true, 'critical', true, true, true, true, false, 5),
  ('lost_contact_moving', 1, now(), true, 'critical', true, true, true, true, false, 5)
ON CONFLICT (incident_type, version) DO NOTHING;
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'fleet.incidents', 'fleet', 'Operational Incidents', 'Review Fleet operational incidents', '/fleet/incidents', 25, true),
  ('page', 'fleet.incidents-settings', 'fleet', 'Operational Incident Settings', 'Manage Fleet incident rules and oversight membership', '/fleet/incidents', 26, true)
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.incidents', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('admin', 'fleet.incidents', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('manager', 'fleet.incidents', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('project_manager', 'fleet.incidents', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('super_admin', 'fleet.incidents-settings', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('admin', 'fleet.incidents-settings', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
