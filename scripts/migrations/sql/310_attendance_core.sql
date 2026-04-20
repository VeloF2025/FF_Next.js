-- Migration 310: Time & Attendance core schema
-- (renumbered from 301 to avoid collision with 301_expand_ticket_category_pp_olt.sql)
--
-- Introduces the /my employee self-service portal's attendance tables:
--   - public_holidays           — SA Public Holidays Act 36 of 1994 calendar (observed dates, incl. Sunday→Monday rollover)
--   - attendance_credentials    — per-staff PIN and/or password hashes (separate from users.password_hash by design)
--   - attendance_auth_sessions  — HMAC session audit for /my portal logins
--   - attendance_overtime_rules — BCEA rule profile (single default for MVP)
--   - attendance_entries        — one row per paired clock-in/clock-out, GPS + selfie + vehicle snapshot
--   - attendance_exceptions     — typed exceptions (missing clock-out, geofence mismatch, clock skew, manual override, etc.)
--   - attendance_selfie_access_log — POPIA audit trail for any admin view of a biometric selfie
--
-- Adds columns:
--   - staff.bcea_applicable                  (BCEA threshold computed boolean; default true)
--   - staff.ordinarily_works_sundays         (affects Sunday multiplier, BCEA s16)
--   - staff.home_site_id                     (default geofence for clock-in when no vehicle assigned)
--   - fleet_vehicles.cartrack_vehicle_id     (Phase 2 Cartrack cross-check join key)
--
-- Seeds:
--   - 1 default BCEA overtime rule
--   - SA public holidays 2026–2028 (observed dates, reflecting s1(3) Sunday→Monday rollover)
--   - RBAC: people.staff.tabs.attendance, people.staff.attendance.manage, my portal module
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. public_holidays
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public_holidays (
    date DATE PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    observes_date DATE,                              -- original proclaimed date if rolled over from Sunday; NULL otherwise
    is_proclaimed BOOLEAN NOT NULL DEFAULT true,     -- false only for future religious/observance additions
    source_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_holidays_date ON public_holidays(date);

-- 2026
INSERT INTO public_holidays (date, name, observes_date, source_reference) VALUES
  ('2026-01-01', 'New Year''s Day',              NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-03-21', 'Human Rights Day',             NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-04-03', 'Good Friday',                  NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-04-06', 'Family Day',                   NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-04-27', 'Freedom Day',                  NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-05-01', 'Workers'' Day',                NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-06-16', 'Youth Day',                    NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-08-10', 'National Women''s Day (observed)', '2026-08-09', 'Public Holidays Act 36 of 1994 s1(1)(a) + s1(3)'),
  ('2026-09-24', 'Heritage Day',                 NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-12-16', 'Day of Reconciliation',        NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-12-25', 'Christmas Day',                NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2026-12-26', 'Day of Goodwill',              NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)')
ON CONFLICT (date) DO NOTHING;

-- 2027 (Human Rights Day Sun → Mon; Boxing Day Sun → Mon)
INSERT INTO public_holidays (date, name, observes_date, source_reference) VALUES
  ('2027-01-01', 'New Year''s Day',              NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-03-22', 'Human Rights Day (observed)',  '2027-03-21',  'Public Holidays Act 36 of 1994 s1(1)(a) + s1(3)'),
  ('2027-03-26', 'Good Friday',                  NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-03-29', 'Family Day',                   NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-04-27', 'Freedom Day',                  NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-05-01', 'Workers'' Day',                NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-06-16', 'Youth Day',                    NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-08-09', 'National Women''s Day',        NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-09-24', 'Heritage Day',                 NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-12-16', 'Day of Reconciliation',        NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-12-25', 'Christmas Day',                NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2027-12-27', 'Day of Goodwill (observed)',   '2027-12-26',  'Public Holidays Act 36 of 1994 s1(1)(a) + s1(3)')
ON CONFLICT (date) DO NOTHING;

-- 2028 (Heritage Day Sun → Mon)
INSERT INTO public_holidays (date, name, observes_date, source_reference) VALUES
  ('2028-01-01', 'New Year''s Day',              NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-03-21', 'Human Rights Day',             NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-04-14', 'Good Friday',                  NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-04-17', 'Family Day',                   NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-04-27', 'Freedom Day',                  NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-05-01', 'Workers'' Day',                NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-06-16', 'Youth Day',                    NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-08-09', 'National Women''s Day',        NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-09-25', 'Heritage Day (observed)',      '2028-09-24',  'Public Holidays Act 36 of 1994 s1(1)(a) + s1(3)'),
  ('2028-12-16', 'Day of Reconciliation',        NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-12-25', 'Christmas Day',                NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)'),
  ('2028-12-26', 'Day of Goodwill',              NULL,          'Public Holidays Act 36 of 1994 s1(1)(a)')
ON CONFLICT (date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. staff column additions
-- ---------------------------------------------------------------------------

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS bcea_applicable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ordinarily_works_sundays BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_site_id UUID REFERENCES fleet_authorized_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_home_site ON staff(home_site_id) WHERE home_site_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. fleet_vehicles.cartrack_vehicle_id
-- ---------------------------------------------------------------------------

ALTER TABLE fleet_vehicles
  ADD COLUMN IF NOT EXISTS cartrack_vehicle_id TEXT;

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_cartrack_id
  ON fleet_vehicles(cartrack_vehicle_id)
  WHERE cartrack_vehicle_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. attendance_credentials
-- ---------------------------------------------------------------------------
-- Separate from users.password_hash: field staff use 6-digit PIN bcrypts,
-- office staff use email+password bcrypts. Conflating them confuses the
-- threat model and breaks lockout accounting.

CREATE TABLE IF NOT EXISTS attendance_credentials (
    staff_id UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,

    pin_hash TEXT,                                   -- bcrypt of 6-digit PIN; NULL if staff uses password flow
    password_hash TEXT,                              -- bcrypt of password; NULL if staff uses PIN flow

    phone_verified_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,

    device_fingerprint_primary TEXT,                 -- first trusted device; new devices require OTP

    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,                        -- set when failed_attempts >= 5

    selfie_consent_at TIMESTAMPTZ,                   -- POPIA s26 biometric consent capture (required before clock-in)
    selfie_consent_version INTEGER,                  -- bumps when privacy notice changes

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_credentials_has_at_least_one_hash
      CHECK (pin_hash IS NOT NULL OR password_hash IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- 5. attendance_auth_sessions
-- ---------------------------------------------------------------------------
-- Named with "auth" prefix to avoid colliding with the work-session mental
-- model (an attendance_entry is the "work session"; this is the login session).

CREATE TABLE IF NOT EXISTS attendance_auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,

    cookie_hash TEXT NOT NULL,                       -- SHA-256 of the HMAC-signed cookie value; raw value never stored
    login_method VARCHAR(16) NOT NULL CHECK (login_method IN ('pin', 'password')),

    ip_address INET,
    user_agent TEXT,
    device_fingerprint TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(32)                       -- 'logout' | 'expired' | 'forced' | 'new_device'
);

CREATE INDEX IF NOT EXISTS idx_attendance_auth_sessions_staff_active
  ON attendance_auth_sessions(staff_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_auth_sessions_cookie
  ON attendance_auth_sessions(cookie_hash)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. attendance_overtime_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_overtime_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,

    daily_ordinary_hrs NUMERIC(4,2) NOT NULL DEFAULT 9.00,    -- BCEA s9: max 9h ordinary per day on a 5-day week
    weekly_ordinary_hrs NUMERIC(5,2) NOT NULL DEFAULT 45.00,  -- BCEA s9: max 45h ordinary per week
    weekly_ot_cap_hrs NUMERIC(5,2) NOT NULL DEFAULT 10.00,    -- BCEA s10: max 10h overtime per week

    ot_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,         -- BCEA s10: 1.5× for overtime
    sunday_multiplier_default NUMERIC(3,2) NOT NULL DEFAULT 2.00,      -- BCEA s16: 2× when not ordinarily worked
    sunday_ordinary_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,     -- BCEA s16: 1.5× when ordinarily worked
    holiday_multiplier NUMERIC(3,2) NOT NULL DEFAULT 2.00,             -- BCEA s18: double pay for public holidays worked

    night_shift_allowance NUMERIC(3,2) NOT NULL DEFAULT 0.10,          -- BCEA s17: 10% allowance for 18:00–06:00 work
    night_start TIME NOT NULL DEFAULT '18:00',
    night_end TIME NOT NULL DEFAULT '06:00',

    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one rule can be the default at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_overtime_rules_one_default
  ON attendance_overtime_rules(is_default)
  WHERE is_default = true;

-- Seed the BCEA default rule
INSERT INTO attendance_overtime_rules (name, is_default, is_active)
SELECT 'SA BCEA Default', true, true
WHERE NOT EXISTS (SELECT 1 FROM attendance_overtime_rules WHERE is_default = true);

-- ---------------------------------------------------------------------------
-- 7. attendance_entries
-- ---------------------------------------------------------------------------
-- One row per paired clock-in and clock-out. An "open" row is a staff member
-- currently clocked in; "closed" means clock-out happened normally.

CREATE TABLE IF NOT EXISTS attendance_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,

    work_date DATE NOT NULL,                         -- server-computed: (clock_in_at AT TIME ZONE 'Africa/Johannesburg')::date

    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,

    -- Device-reported occurred_at (can be post-theft backdated if session cookie compromised;
    -- we store both and use client_occurred_at for payroll math, received_at for fraud flagging)
    client_occurred_at_in TIMESTAMPTZ NOT NULL,
    client_occurred_at_out TIMESTAMPTZ,
    received_at_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at_out TIMESTAMPTZ,

    -- Device GPS at clock-in
    clock_in_lat NUMERIC(10,7),
    clock_in_lon NUMERIC(10,7),
    clock_in_accuracy_m NUMERIC(8,2),

    -- Device GPS at clock-out
    clock_out_lat NUMERIC(10,7),
    clock_out_lon NUMERIC(10,7),
    clock_out_accuracy_m NUMERIC(8,2),

    -- Selfie URLs (VF Storage, deleted after 90-day POPIA retention)
    selfie_in_url TEXT,
    selfie_out_url TEXT,

    -- Snapshots at clock-in time (so later re-assignments don't rewrite history)
    vehicle_assignment_id UUID REFERENCES vehicle_assignments(id) ON DELETE SET NULL,
    site_geofence_id UUID REFERENCES fleet_authorized_locations(id) ON DELETE SET NULL,

    device_fingerprint TEXT,
    device_user_agent TEXT,

    status VARCHAR(16) NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'closed', 'auto_closed', 'manual', 'disputed')),

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one open entry per staff member at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_entries_one_open_per_staff
  ON attendance_entries(staff_id)
  WHERE status = 'open';

-- Fast "did this staff clock in today" lookups
CREATE INDEX IF NOT EXISTS idx_attendance_entries_staff_date
  ON attendance_entries(staff_id, work_date DESC);

-- Admin roster: "who's at work right now, who's late"
CREATE INDEX IF NOT EXISTS idx_attendance_entries_date_status
  ON attendance_entries(work_date, status);

-- Cartrack cross-check join
CREATE INDEX IF NOT EXISTS idx_attendance_entries_vehicle_assignment
  ON attendance_entries(vehicle_assignment_id, clock_in_at)
  WHERE vehicle_assignment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. attendance_exceptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES attendance_entries(id) ON DELETE CASCADE,

    exception_kind VARCHAR(32) NOT NULL CHECK (exception_kind IN (
        'missing_clock_out',
        'geofence_mismatch',
        'clock_skew',
        'out_of_hours',
        'manual_override',
        'duplicate_entry',
        'vehicle_gps_mismatch',
        'forgotten_clock_out_retro'
    )),

    severity VARCHAR(16) NOT NULL DEFAULT 'warning'
      CHECK (severity IN ('info', 'warning', 'critical')),

    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB,                                   -- kind-specific context (e.g., distance_m, skew_seconds)

    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_unresolved
  ON attendance_exceptions(detected_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_entry
  ON attendance_exceptions(entry_id);

-- ---------------------------------------------------------------------------
-- 9. attendance_selfie_access_log (POPIA)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_selfie_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES attendance_entries(id) ON DELETE CASCADE,
    selfie_type VARCHAR(8) NOT NULL CHECK (selfie_type IN ('in', 'out')),
    viewed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    context VARCHAR(32)                              -- 'staff_detail', 'exception_review', 'correction_review', etc.
);

CREATE INDEX IF NOT EXISTS idx_attendance_selfie_access_log_entry
  ON attendance_selfie_access_log(entry_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_selfie_access_log_viewer
  ON attendance_selfie_access_log(viewed_by, viewed_at DESC);

-- ---------------------------------------------------------------------------
-- 10. RBAC: access_permissions + role_permissions
-- ---------------------------------------------------------------------------

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  -- My self-service portal (top-level, externally-scoped to staff users)
  ('module', 'my', NULL,
   'My Portal', 'Employee self-service portal (attendance, payslips, leave)',
   '/my', 90, true),

  ('page', 'my.attendance', 'my',
   'My Attendance', 'Clock in/out and view personal attendance history',
   '/my/attendance', 1, true),

  -- Staff module — attendance sub-tab + management permission
  ('page', 'people.staff.tabs.attendance', 'people.staff',
   'Attendance', 'View staff attendance entries and exceptions',
   NULL, 11, true),

  ('page', 'people.staff.attendance.manage', 'people.staff',
   'Attendance Management', 'Approve corrections, create manual entries, view all staff attendance, export payroll',
   '/staff/attendance', 12, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  -- my module: all staff roles can see their own portal
  ('super_admin',     'my', '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',         'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('technician',      'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('viewer',          'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('contractor',      'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('storeman',        'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('project_manager', 'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('qa_manager',      'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('site_supervisor', 'my', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('client',          'my', '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- my.attendance: same as parent
  ('super_admin',     'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('admin',           'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',         'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('technician',      'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('viewer',          'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('contractor',      'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('storeman',        'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('project_manager', 'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('qa_manager',      'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('site_supervisor', 'my.attendance', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('client',          'my.attendance', '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- people.staff.tabs.attendance: view own (all HR-facing roles)
  ('super_admin',     'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('admin',           'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('manager',         'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('technician',      'people.staff.tabs.attendance', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.tabs.attendance', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.tabs.attendance', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'people.staff.tabs.attendance', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('client',          'people.staff.tabs.attendance', '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- people.staff.attendance.manage: approve, manual entry, export (HR + super_admin + admin only)
  ('super_admin',     'people.staff.attendance.manage', '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'people.staff.attendance.manage', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',         'people.staff.attendance.manage', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('technician',      'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'people.staff.attendance.manage', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('client',          'people.staff.attendance.manage', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. GRANTs for the runtime app user
-- ---------------------------------------------------------------------------
-- Migrations run as superuser `postgres`, so new tables are owned by postgres.
-- The app runs as `fibreflow_user`, which needs explicit CRUD on every new
-- object. Missing this step is a common footgun post-Supabase cutover.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public_holidays              TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_credentials      TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_auth_sessions    TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_overtime_rules   TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_entries          TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_exceptions       TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON attendance_selfie_access_log TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) AS holidays_seeded FROM public_holidays;
-- SELECT name, daily_ordinary_hrs, weekly_ot_cap_hrs FROM attendance_overtime_rules WHERE is_default;
-- SELECT key FROM access_permissions WHERE key LIKE 'my%' OR key LIKE '%.attendance%' ORDER BY key;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'staff' AND column_name IN ('bcea_applicable','ordinarily_works_sundays','home_site_id');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'fleet_vehicles' AND column_name = 'cartrack_vehicle_id';
