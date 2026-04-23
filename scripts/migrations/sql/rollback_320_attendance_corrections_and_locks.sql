-- Rollback for migration 320.
--
-- Safe to run pre- or post-migration. Uses IF EXISTS.

DROP INDEX IF EXISTS idx_attendance_weekly_locks_active;
DROP TABLE IF EXISTS attendance_weekly_locks;

DROP INDEX IF EXISTS idx_attendance_adjustments_requester;
DROP INDEX IF EXISTS idx_attendance_adjustments_entry;
DROP INDEX IF EXISTS idx_attendance_adjustments_pending;
DROP TABLE IF EXISTS attendance_adjustments;

DELETE FROM role_permissions WHERE permission_key IN (
  'my.attendance.corrections',
  'people.staff.attendance.corrections',
  'people.staff.attendance.locks'
);
DELETE FROM access_permissions WHERE key IN (
  'my.attendance.corrections',
  'people.staff.attendance.corrections',
  'people.staff.attendance.locks'
);
