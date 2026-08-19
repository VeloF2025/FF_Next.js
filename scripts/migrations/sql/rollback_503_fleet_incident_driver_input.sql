-- Rollback 503. This removes the PR7 driver-input tables and reverts the
-- PR6 evidence/actions visibility extension. Execute only with approval.

DROP TABLE IF EXISTS fleet_incident_attendance_correction_links;
DROP TABLE IF EXISTS fleet_incident_driver_submissions;
DROP TABLE IF EXISTS fleet_incident_driver_input_requests;
DROP TABLE IF EXISTS fleet_incident_driver_input_settings;

ALTER TABLE fleet_operational_incident_actions
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_actions_type_check;
ALTER TABLE fleet_operational_incident_actions
  ADD CONSTRAINT fleet_operational_incident_actions_type_check
  CHECK (action_type IN (
    'opened', 'acknowledged', 'review_started', 'commented', 'escalated',
    'condition_cleared', 'resolved', 'dismissed', 'evidence_added', 'recipient_changed'
  ));
ALTER TABLE fleet_operational_incident_actions
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_actions_actor_check;
ALTER TABLE fleet_operational_incident_actions
  ADD CONSTRAINT fleet_operational_incident_actions_actor_check
  CHECK ((actor_user_id IS NOT NULL) <> is_system_actor);
ALTER TABLE fleet_operational_incident_actions
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_actions_visibility_check;
ALTER TABLE fleet_operational_incident_actions
  DROP COLUMN IF EXISTS actor_staff_id;
ALTER TABLE fleet_operational_incident_actions
  DROP COLUMN IF EXISTS visibility;

ALTER TABLE fleet_operational_incident_evidence
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_evidence_uploader_pair_check;
ALTER TABLE fleet_operational_incident_evidence
  DROP CONSTRAINT IF EXISTS fleet_operational_incident_evidence_visibility_check;
ALTER TABLE fleet_operational_incident_evidence
  DROP COLUMN IF EXISTS uploaded_by_staff_id;
ALTER TABLE fleet_operational_incident_evidence
  DROP COLUMN IF EXISTS visibility;

DELETE FROM schema_migrations
 WHERE filename = '503_fleet_incident_driver_input.sql';
