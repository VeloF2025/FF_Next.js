-- Migration 332: Pulse · Bulk Actions (PRD-061 Phase D)
--
-- Adds:
--   1. New permission `people.staff.attendance.bulk_lock` (super_admin/admin only)
--   2. New table `attendance_bulk_action_audit` — one row per affected staff
--      per bulk action, with a shared `batch_id` so the action is traceable
--      as a single intent (FR-BULK-06).
--
-- The lock itself is week-level (one row in attendance_weekly_locks per week);
-- the audit table records WHICH staff a given week-lock decision applied to,
-- the actor, the reason, and a batch_id grouping them. Bulk correction-request
-- audit rows use the same shape with `action='bulk_correction_request'`.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Permission seed (FR-BULK-07)
-- ---------------------------------------------------------------------------
-- Cascades from `people.staff` to match the existing `.locks`/`.search`
-- siblings (no `people.staff.attendance` parent row exists today).

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('action', 'people.staff.attendance.bulk_lock', 'people.staff',
   'Bulk Lock Weeks',
   'Bulk-lock payroll weeks across multiple staff with a shared audit trail',
   NULL, 16, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin',     'people.staff.attendance.bulk_lock', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('admin',           'people.staff.attendance.bulk_lock', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('manager',         'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',      'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. attendance_bulk_action_audit (FR-BULK-06)
-- ---------------------------------------------------------------------------
-- Append-only audit. UI never deletes rows here (NFR-SEC-05). The actor's
-- user_id and the target staff_id are FK'd so a staff or user delete keeps
-- referential integrity (ON DELETE RESTRICT for actor — losing the actor
-- would orphan the audit; ON DELETE CASCADE for staff — when a staff record
-- is purged, their audit history follows).

CREATE TABLE IF NOT EXISTS attendance_bulk_action_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        UUID NOT NULL,
    actor_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action          VARCHAR(32) NOT NULL CHECK (action IN (
                      'bulk_lock',
                      'bulk_correction_request'
                    )),
    target_staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    -- Date or week-Monday the audit row applies to. For bulk_lock this is
    -- the ISO-week Monday; for bulk_correction_request it is the work_date
    -- of the affected entry. Kept as a single column so a future viewer
    -- doesn't have to UNION two date columns.
    target_week_or_date DATE NOT NULL,
    reason_note     TEXT NOT NULL CHECK (length(trim(reason_note)) >= 10),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Group all rows of one bulk action (FR-BULK-06)
CREATE INDEX IF NOT EXISTS idx_aba_batch
  ON attendance_bulk_action_audit (batch_id);

-- "What did Hein do this week?" — admin audit-trail viewer.
CREATE INDEX IF NOT EXISTS idx_aba_actor_created
  ON attendance_bulk_action_audit (actor_user_id, created_at DESC);

-- "Show me all bulk actions on staff X" — incident triage.
CREATE INDEX IF NOT EXISTS idx_aba_target_staff_created
  ON attendance_bulk_action_audit (target_staff_id, created_at DESC);

GRANT SELECT, INSERT, REFERENCES
  ON attendance_bulk_action_audit TO fibreflow_user;

COMMENT ON TABLE attendance_bulk_action_audit IS
  'Append-only audit trail for Pulse bulk actions (FR-BULK-06). One row per '
  'affected staff per action, grouped by batch_id. UI must never offer a '
  'delete path on these rows (NFR-SEC-05).';

-- ---------------------------------------------------------------------------
-- Verify (uncomment after apply)
-- ---------------------------------------------------------------------------
-- SELECT key FROM access_permissions WHERE key = 'people.staff.attendance.bulk_lock';
-- SELECT role, actions FROM role_permissions WHERE permission_key = 'people.staff.attendance.bulk_lock' ORDER BY role;
-- \d attendance_bulk_action_audit
