-- 503_fleet_incident_driver_input.sql
-- Optional, append-only driver access to Fleet operational incidents (PR7).
-- No person is seeded here. Extends PR6 (migration 502) evidence/actions
-- with a visibility class and adds four durable tables: effective-dated
-- driver-input settings, manager requests, driver submissions, and
-- canonical Attendance correction links. Every application grant below is
-- INSERT/SELECT only except the settings table, which is versioned by
-- closing the currently-open row (UPDATE) before inserting the next
-- version -- requests/submissions/links stay strictly append-only so a
-- driver's accepted record can never be silently edited after the fact.
CREATE TABLE IF NOT EXISTS fleet_incident_driver_input_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  response_window_workdays INTEGER NOT NULL DEFAULT 2,
  post_closure_response_enabled BOOLEAN NOT NULL DEFAULT false,
  post_closure_response_window_days INTEGER NOT NULL DEFAULT 0,
  recent_window_days INTEGER NOT NULL DEFAULT 90,
  history_window_days INTEGER NOT NULL DEFAULT 365,
  enabled_concern_categories TEXT[] NOT NULL DEFAULT ARRAY[
    'assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'
  ]::text[],
  evidence_allowed_mime_types TEXT[] NOT NULL DEFAULT ARRAY[
    'image/jpeg', 'image/png', 'application/pdf'
  ]::text[],
  evidence_max_bytes INTEGER NOT NULL DEFAULT 15728640,
  driver_input_requested_in_app BOOLEAN NOT NULL DEFAULT true,
  driver_input_requested_email BOOLEAN NOT NULL DEFAULT true,
  driver_input_requested_whatsapp BOOLEAN NOT NULL DEFAULT false,
  driver_response_received_in_app BOOLEAN NOT NULL DEFAULT true,
  driver_response_received_email BOOLEAN NOT NULL DEFAULT true,
  driver_response_received_whatsapp BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_incident_driver_input_settings_version_positive CHECK (version > 0),
  CONSTRAINT fleet_incident_driver_input_settings_version_unique UNIQUE (version),
  CONSTRAINT fleet_incident_driver_input_settings_range_order CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fleet_incident_driver_input_settings_reason_nonblank CHECK (change_reason IS NULL OR btrim(change_reason) <> ''),
  CONSTRAINT fleet_incident_driver_input_settings_workdays_positive CHECK (response_window_workdays > 0),
  CONSTRAINT fleet_incident_driver_input_settings_post_closure_window_check CHECK (
    (post_closure_response_enabled = false AND post_closure_response_window_days = 0)
    OR (post_closure_response_enabled = true AND post_closure_response_window_days > 0)
  ),
  CONSTRAINT fleet_incident_driver_input_settings_windows_positive CHECK (recent_window_days > 0 AND history_window_days > 0),
  CONSTRAINT fleet_incident_driver_input_settings_history_covers_recent CHECK (history_window_days >= recent_window_days),
  CONSTRAINT fleet_incident_driver_input_settings_categories_check CHECK (
    enabled_concern_categories <@ ARRAY['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other']::text[]
    AND array_length(enabled_concern_categories, 1) > 0
  ),
  CONSTRAINT fleet_incident_driver_input_settings_mime_nonempty CHECK (array_length(evidence_allowed_mime_types, 1) > 0),
  CONSTRAINT fleet_incident_driver_input_settings_bytes_positive CHECK (evidence_max_bytes > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_incident_driver_input_settings_open ON fleet_incident_driver_input_settings ((true)) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_fleet_incident_driver_input_settings_effective ON fleet_incident_driver_input_settings (effective_from, effective_to);
CREATE TABLE IF NOT EXISTS fleet_incident_driver_input_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  guidance TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  respond_by TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_incident_driver_input_requests_guidance_nonblank CHECK (guidance IS NULL OR btrim(guidance) <> ''),
  CONSTRAINT fleet_incident_driver_input_requests_idempotency_nonblank CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT fleet_incident_driver_input_requests_respond_by_future CHECK (respond_by > requested_at),
  CONSTRAINT fleet_incident_driver_input_requests_idempotency_unique UNIQUE (incident_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_fleet_incident_driver_input_requests_incident ON fleet_incident_driver_input_requests (incident_id, requested_at DESC);
CREATE TABLE IF NOT EXISTS fleet_incident_driver_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  input_request_id UUID REFERENCES fleet_incident_driver_input_requests(id) ON DELETE SET NULL,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  submission_kind TEXT NOT NULL,
  explanation TEXT NOT NULL,
  concern_category TEXT,
  idempotency_key TEXT NOT NULL,
  client_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_incident_driver_submissions_kind_check CHECK (submission_kind IN ('response', 'follow_up')),
  CONSTRAINT fleet_incident_driver_submissions_explanation_nonblank CHECK (btrim(explanation) <> ''),
  CONSTRAINT fleet_incident_driver_submissions_category_check CHECK (
    concern_category IS NULL OR concern_category IN ('assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other')
  ),
  CONSTRAINT fleet_incident_driver_submissions_metadata_object CHECK (jsonb_typeof(client_metadata) = 'object'),
  CONSTRAINT fleet_incident_driver_submissions_idempotency_nonblank CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT fleet_incident_driver_submissions_idempotency_unique UNIQUE (incident_id, staff_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_fleet_incident_driver_submissions_incident ON fleet_incident_driver_submissions (incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_fleet_incident_driver_submissions_staff ON fleet_incident_driver_submissions (staff_id, created_at DESC);
CREATE TABLE IF NOT EXISTS fleet_incident_attendance_correction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES fleet_operational_incidents(id) ON DELETE RESTRICT,
  driver_submission_id UUID REFERENCES fleet_incident_driver_submissions(id) ON DELETE SET NULL,
  attendance_correction_id UUID NOT NULL REFERENCES attendance_adjustments(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  linked_by UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_incident_attendance_correction_links_unique UNIQUE (incident_id, attendance_correction_id)
);
CREATE INDEX IF NOT EXISTS ix_fleet_incident_attendance_correction_links_incident ON fleet_incident_attendance_correction_links (incident_id, linked_at DESC);
-- PR6 visibility extension. Existing rows and every future manager-authored
-- row default to 'internal' so nothing is retroactively or accidentally
-- disclosed to a driver; only an explicit 'shared_with_driver'/
-- 'driver_submitted' write becomes driver-visible.
ALTER TABLE fleet_operational_incident_evidence
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS uploaded_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE fleet_operational_incident_evidence
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_evidence_visibility_check;
ALTER TABLE fleet_operational_incident_evidence
  ADD CONSTRAINT fleet_operational_incident_evidence_visibility_check
  CHECK (visibility IN ('internal', 'shared_with_driver', 'driver_submitted'));
ALTER TABLE fleet_operational_incident_evidence
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_evidence_uploader_pair_check;
ALTER TABLE fleet_operational_incident_evidence
  ADD CONSTRAINT fleet_operational_incident_evidence_uploader_pair_check
  CHECK (uploaded_by IS NULL OR uploaded_by_staff_id IS NULL);
-- actor_staff_id lets a driver (identified by staff, not a users row) be
-- the recorded actor of a 'driver_response_received'/'evidence_added' row,
-- exactly as attendance_decision_events already carries both an
-- actor_user_id and an actor_staff_id for the same reason.
ALTER TABLE fleet_operational_incident_actions
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS actor_staff_id UUID REFERENCES staff(id) ON DELETE RESTRICT;
ALTER TABLE fleet_operational_incident_actions
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_actions_visibility_check;
ALTER TABLE fleet_operational_incident_actions
  ADD CONSTRAINT fleet_operational_incident_actions_visibility_check
  CHECK (visibility IN ('internal', 'shared_with_driver', 'driver_submitted'));
ALTER TABLE fleet_operational_incident_actions
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_actions_actor_check;
ALTER TABLE fleet_operational_incident_actions
  ADD CONSTRAINT fleet_operational_incident_actions_actor_check
  CHECK ((actor_user_id IS NOT NULL)::int + (actor_staff_id IS NOT NULL)::int + is_system_actor::int = 1);
ALTER TABLE fleet_operational_incident_actions
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_actions_type_check;
ALTER TABLE fleet_operational_incident_actions
  ADD CONSTRAINT fleet_operational_incident_actions_type_check
  CHECK (action_type IN (
    'opened', 'acknowledged', 'review_started', 'commented', 'escalated',
    'condition_cleared', 'resolved', 'dismissed', 'evidence_added', 'recipient_changed',
    'driver_input_requested', 'driver_response_received'
  ));
REVOKE ALL ON fleet_incident_driver_input_settings, fleet_incident_driver_input_requests,
  fleet_incident_driver_submissions, fleet_incident_attendance_correction_links FROM fibreflow_user;
GRANT SELECT, INSERT, UPDATE ON fleet_incident_driver_input_settings TO fibreflow_user;
GRANT SELECT, INSERT ON fleet_incident_driver_input_requests, fleet_incident_driver_submissions,
  fleet_incident_attendance_correction_links TO fibreflow_user;
INSERT INTO fleet_incident_driver_input_settings (version, effective_from)
VALUES (1, now())
ON CONFLICT (version) DO NOTHING;
