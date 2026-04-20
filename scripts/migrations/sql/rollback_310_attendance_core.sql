-- Rollback for migration 310: Time & Attendance core schema
--
-- Drops tables in dependency order. Rolls back column additions. Removes RBAC rows.
--
-- WARNING: This is destructive. All clock-in/out data, PIN hashes, session logs,
-- and public holidays seed will be lost. Only use if migration 301 must be undone
-- before any production clock-in data has been captured.
--
-- Idempotent: safe to re-run if a prior rollback was partial.

-- 1. Drop FK-holding tables first (exceptions, selfie access log) then parent (entries)
DROP TABLE IF EXISTS attendance_selfie_access_log;
DROP TABLE IF EXISTS attendance_exceptions;
DROP TABLE IF EXISTS attendance_entries;

-- 2. Auth and rule tables (no downstream FKs)
DROP TABLE IF EXISTS attendance_auth_sessions;
DROP TABLE IF EXISTS attendance_credentials;
DROP TABLE IF EXISTS attendance_overtime_rules;

-- 3. Public holidays calendar
DROP TABLE IF EXISTS public_holidays;

-- 4. Column reversals
ALTER TABLE staff
  DROP COLUMN IF EXISTS bcea_applicable,
  DROP COLUMN IF EXISTS ordinarily_works_sundays,
  DROP COLUMN IF EXISTS home_site_id;

ALTER TABLE fleet_vehicles
  DROP COLUMN IF EXISTS cartrack_vehicle_id;

-- 5. RBAC cleanup
DELETE FROM role_permissions WHERE permission_key IN (
  'my',
  'my.attendance',
  'people.staff.tabs.attendance',
  'people.staff.attendance.manage'
);

DELETE FROM access_permissions WHERE key IN (
  'my',
  'my.attendance',
  'people.staff.tabs.attendance',
  'people.staff.attendance.manage'
);
