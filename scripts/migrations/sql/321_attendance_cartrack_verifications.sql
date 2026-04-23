-- Migration 321: Time & Attendance Phase 2 — Cartrack GPS cross-check
--
-- One row per (entry, check_type) where the reconcile job has tried to
-- corroborate the device GPS with the vehicle's Cartrack GPS. Verdict
-- values make the "why did this fail" queryable without re-reading logs:
--
--   match              — device within threshold of vehicle at clock time
--   mismatch           — device > threshold from vehicle (flag exception)
--   no_data            — Cartrack returned no positions in ±5 min window
--   vehicle_not_mapped — fleet_vehicles.cartrack_vehicle_id is NULL
--
-- The verification row is kept even on `no_data` / `vehicle_not_mapped`
-- so the next cron tick doesn't re-hit Cartrack for the same entry —
-- cheaper and less fragile than re-deriving state from absence.
--
-- UI framing — see PRD: this is CORROBORATION, not fraud detection. A
-- driver clocking in from their private car is not fraud; the mismatch
-- exception is informational unless policy promotes it.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS attendance_gps_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES attendance_entries(id) ON DELETE CASCADE,

    -- Which side of the shift this verification is for.
    check_type VARCHAR(8) NOT NULL CHECK (check_type IN ('in', 'out')),

    -- Vehicle side. Nullable when verdict is no_data or vehicle_not_mapped.
    vehicle_cartrack_id TEXT,
    vehicle_lat NUMERIC(10,7),
    vehicle_lon NUMERIC(10,7),
    vehicle_ts TIMESTAMPTZ,

    -- Device side copied at reconcile time from the attendance entry so
    -- the verification is self-contained even if the entry later mutates
    -- (via corrections). Payroll audit reads this, not the entry.
    device_lat NUMERIC(10,7),
    device_lon NUMERIC(10,7),

    distance_m NUMERIC(10,2) CHECK (distance_m IS NULL OR distance_m >= 0),
    threshold_m NUMERIC(10,2) NOT NULL CHECK (threshold_m > 0),

    verdict VARCHAR(24) NOT NULL CHECK (verdict IN (
        'match', 'mismatch', 'no_data', 'vehicle_not_mapped'
    )),

    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_gps_verifications_entry_check UNIQUE (entry_id, check_type),

    -- Match/mismatch require both sides present so we're not pretending a
    -- corroboration happened without data.
    CONSTRAINT attendance_gps_verifications_match_requires_data CHECK (
      verdict NOT IN ('match', 'mismatch')
      OR (vehicle_lat IS NOT NULL AND vehicle_lon IS NOT NULL
          AND device_lat IS NOT NULL AND device_lon IS NOT NULL
          AND distance_m IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_attendance_gps_verifications_entry
  ON attendance_gps_verifications(entry_id);

-- Supervisor review queries filter to mismatches within a date window.
CREATE INDEX IF NOT EXISTS idx_attendance_gps_verifications_mismatch
  ON attendance_gps_verifications(reconciled_at DESC)
  WHERE verdict = 'mismatch';

-- Reconcile cron picks up newly-closed entries the previous cron tick
-- didn't see; presence of a row short-circuits re-processing.
CREATE INDEX IF NOT EXISTS idx_attendance_gps_verifications_reconciled_at
  ON attendance_gps_verifications(reconciled_at DESC);

-- ---------------------------------------------------------------------------
-- Partial UNIQUE index on attendance_exceptions to enforce single-row
-- idempotence for vehicle_gps_mismatch. Without this, a future caller
-- other than the reconcile cron could raise a duplicate exception — the
-- reconcile upsertMismatchAtomic helper uses ON CONFLICT against this
-- index's predicate to dedupe.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_exceptions_vehicle_gps_mismatch_unique
  ON attendance_exceptions(entry_id)
  WHERE exception_kind = 'vehicle_gps_mismatch' AND resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- RBAC — cartrack mapping admin page
-- ---------------------------------------------------------------------------

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'people.staff.attendance.cartrack_mapping', 'people.staff',
   'Cartrack Mapping', 'Map fleet vehicles to Cartrack vehicle IDs for GPS cross-check',
   '/staff/attendance/cartrack-mapping', 15, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  -- One-time mapping is admin + HR only; supervisors don't touch fleet wiring.
  ('super_admin',     'people.staff.attendance.cartrack_mapping', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('admin',           'people.staff.attendance.cartrack_mapping', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',         'people.staff.attendance.cartrack_mapping', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',      'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'people.staff.attendance.cartrack_mapping', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- GRANTs
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON attendance_gps_verifications TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- COMMENTs
-- ---------------------------------------------------------------------------

COMMENT ON TABLE attendance_gps_verifications IS
  'Cartrack GPS cross-check results per (attendance_entries, check_type). '
  'Kept on no_data / vehicle_not_mapped verdicts so the nightly cron does '
  'not re-hit the Cartrack API for entries already attempted.';
COMMENT ON COLUMN attendance_gps_verifications.verdict IS
  'match | mismatch | no_data | vehicle_not_mapped — see migration header.';
COMMENT ON COLUMN attendance_gps_verifications.threshold_m IS
  'Captured at reconcile time so historical rows stay meaningful even if '
  'the default distance threshold changes later.';

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attendance_gps_verifications' ORDER BY ordinal_position;
-- SELECT key FROM access_permissions WHERE key = 'people.staff.attendance.cartrack_mapping';
