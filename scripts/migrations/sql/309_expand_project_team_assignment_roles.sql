-- Migration 309: expand project_team_assignments.role CHECK
--
-- Migration 304 restricted role to activations/maintenance/fault_repair/other,
-- but the Teams UI also offers civils and optical. Those selections currently
-- hit the CHECK constraint (23514) and the client swallows the error, so the
-- assignment silently fails to persist.
--
-- Align the constraint with the role set used in TeamProjectAssignments.tsx.
-- Safe to re-run.

ALTER TABLE project_team_assignments
  DROP CONSTRAINT IF EXISTS project_team_assignments_role_check;

ALTER TABLE project_team_assignments
  ADD CONSTRAINT project_team_assignments_role_check
  CHECK (role IN ('activations', 'maintenance', 'civils', 'optical', 'fault_repair', 'other'));
