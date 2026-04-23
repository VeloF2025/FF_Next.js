-- Migration 320: Time & Attendance Phase 1c — corrections workflow + weekly locks
--
-- Introduces the supervisor-approval and week-locking layer on top of
-- Phase 1a's attendance_entries and Phase 1b's attendance_daily_summaries:
--
--   - attendance_adjustments    — staff-submitted corrections to entries
--                                 (forgot-clock-out retro, wrong-site, etc.)
--                                 with supervisor review state machine.
--   - attendance_weekly_locks   — payroll week locks. Export action sets
--                                 the lock; corrections on locked weeks
--                                 require an HR unlock first.
--
-- The actual enforcement (reject correction submit when week is locked,
-- recompute summary on approval) lives in the API handlers; this migration
-- only creates the tables + RBAC seeds. A strict DB-level enforcement
-- trigger would block legitimate HR-override flows.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. attendance_adjustments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES attendance_entries(id) ON DELETE CASCADE,

    -- Who submitted the correction — references staff(id), not users(id).
    -- The /my portal session carries staff_id (not user_id); submitting as
    -- users.id would require a staff→users join on every write. Keeping
    -- this staff-scoped mirrors attendance_entries.staff_id and lets the
    -- FK naturally cascade with the staff member.
    requested_by UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,

    -- What's being changed. Extend cautiously: payroll vendors need to
    -- know why an entry moved.
    adjustment_kind VARCHAR(32) NOT NULL CHECK (adjustment_kind IN (
        'forgot_clock_out',
        'wrong_clock_in_time',
        'wrong_clock_out_time',
        'wrong_site',
        'duplicate_entry',
        'other'
    )),

    -- Proposed values. Null means "no change to this field".
    adjusted_clock_in_at  TIMESTAMPTZ,
    adjusted_clock_out_at TIMESTAMPTZ,
    adjusted_site_geofence_id UUID REFERENCES fleet_authorized_locations(id) ON DELETE SET NULL,

    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),

    status VARCHAR(16) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

    -- Review audit. `reviewed_by` is NULL until the state transitions
    -- out of 'pending'. The state-machine integrity is enforced by the
    -- API handler (only pending→approved/rejected/cancelled allowed), not
    -- by a trigger.
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- At least one of the adjusted_* columns must be non-null — an
    -- adjustment that changes nothing is a spec bug.
    CONSTRAINT attendance_adjustments_at_least_one_change CHECK (
      adjusted_clock_in_at IS NOT NULL
      OR adjusted_clock_out_at IS NOT NULL
      OR adjusted_site_geofence_id IS NOT NULL
    ),

    -- reviewed_at + reviewed_by MUST be set together (both or neither),
    -- and only for terminal states.
    CONSTRAINT attendance_adjustments_review_fields_paired CHECK (
      (reviewed_at IS NULL AND reviewed_by IS NULL)
      OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    ),
    CONSTRAINT attendance_adjustments_review_requires_terminal CHECK (
      (reviewed_at IS NULL AND status = 'pending')
      OR (reviewed_at IS NOT NULL AND status IN ('approved', 'rejected', 'cancelled'))
    )
);

-- Pending-queue for supervisors: one row per unresolved correction
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_pending
  ON attendance_adjustments(created_at ASC)
  WHERE status = 'pending';

-- Per-entry history (audit trail on entry detail pages)
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_entry
  ON attendance_adjustments(entry_id, created_at DESC);

-- Per-requester history (my submissions list on /my/attendance/corrections)
CREATE INDEX IF NOT EXISTS idx_attendance_adjustments_requester
  ON attendance_adjustments(requested_by, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. attendance_weekly_locks
-- ---------------------------------------------------------------------------
-- One row per locked ISO-week-Monday. Absence of a row = week is unlocked.
-- Export handler sets the lock on download; HR can unlock with a reason.

CREATE TABLE IF NOT EXISTS attendance_weekly_locks (
    week_start_date DATE PRIMARY KEY CHECK (EXTRACT(DOW FROM week_start_date) = 1),
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    lock_reason TEXT,

    -- Unlock audit (NULL = currently locked). Re-locking after unlock
    -- writes a new row in attendance_weekly_lock_history (Phase 1d if we
    -- need full audit); Phase 1c just mutates this row.
    unlocked_at TIMESTAMPTZ,
    unlocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    unlock_reason TEXT,

    CONSTRAINT attendance_weekly_locks_unlock_paired CHECK (
      (unlocked_at IS NULL AND unlocked_by IS NULL)
      OR (unlocked_at IS NOT NULL AND unlocked_by IS NOT NULL)
    )
);

-- Fast lookup "is this week locked right now"
CREATE INDEX IF NOT EXISTS idx_attendance_weekly_locks_active
  ON attendance_weekly_locks(week_start_date)
  WHERE unlocked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. RBAC: access_permissions + role_permissions
-- ---------------------------------------------------------------------------

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'my.attendance.corrections', 'my',
   'My Corrections', 'Submit attendance corrections and view your submissions',
   '/my/attendance/corrections', 2, true),

  ('page', 'people.staff.attendance.corrections', 'people.staff',
   'Attendance Corrections', 'Review and approve/reject staff attendance corrections',
   '/staff/attendance/corrections', 13, true),

  ('page', 'people.staff.attendance.locks', 'people.staff',
   'Weekly Locks', 'Lock or unlock payroll weeks to freeze attendance entries',
   '/staff/attendance/locks', 14, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  -- my.attendance.corrections: all staff can submit + view their own
  ('super_admin',     'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('admin',           'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('manager',         'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('technician',      'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('viewer',          'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('contractor',      'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('storeman',        'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('project_manager', 'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('qa_manager',      'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('site_supervisor', 'my.attendance.corrections', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('client',          'my.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- people.staff.attendance.corrections: review queue (HR + super_admin + admin + supervisor)
  ('super_admin',     'people.staff.attendance.corrections', '{"view":true,"create":false,"edit":true,"delete":false}'),
  ('admin',           'people.staff.attendance.corrections', '{"view":true,"create":false,"edit":true,"delete":false}'),
  ('manager',         'people.staff.attendance.corrections', '{"view":true,"create":false,"edit":true,"delete":false}'),
  ('site_supervisor', 'people.staff.attendance.corrections', '{"view":true,"create":false,"edit":true,"delete":false}'),
  ('technician',      'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'people.staff.attendance.corrections', '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- people.staff.attendance.locks: week-lock management (HR + super_admin + admin only — supervisors see but can't unlock)
  ('super_admin',     'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',         'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('site_supervisor', 'people.staff.attendance.locks', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('technician',      'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'people.staff.attendance.locks', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. GRANTs for the runtime app user
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_adjustments    TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_weekly_locks   TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- 5. COMMENTs
-- ---------------------------------------------------------------------------

COMMENT ON TABLE attendance_adjustments IS
  'Staff-submitted corrections to attendance_entries. Supervisors approve or reject; '
  'approval triggers re-computation of the affected (staff, work_date) daily summary.';
COMMENT ON TABLE attendance_weekly_locks IS
  'Payroll week locks keyed by ISO-week Monday. Presence of a row WHERE unlocked_at IS NULL '
  'means the week is frozen: no new entries, no approved corrections without an HR unlock first.';
COMMENT ON COLUMN attendance_weekly_locks.week_start_date IS
  'ISO-week Monday — enforced by CHECK (EXTRACT(DOW) = 1).';

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attendance_adjustments' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attendance_weekly_locks' ORDER BY ordinal_position;
-- SELECT key FROM access_permissions WHERE key IN ('my.attendance.corrections', 'people.staff.attendance.corrections', 'people.staff.attendance.locks');
