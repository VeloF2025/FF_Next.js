-- Rollback for migration 321.
-- Safe pre/post-migration. IF EXISTS on everything.

DROP INDEX IF EXISTS idx_attendance_exceptions_vehicle_gps_mismatch_unique;
DROP INDEX IF EXISTS idx_attendance_gps_verifications_reconciled_at;
DROP INDEX IF EXISTS idx_attendance_gps_verifications_mismatch;
DROP INDEX IF EXISTS idx_attendance_gps_verifications_entry;

DROP TABLE IF EXISTS attendance_gps_verifications;

DELETE FROM role_permissions WHERE permission_key = 'people.staff.attendance.cartrack_mapping';
DELETE FROM access_permissions WHERE key = 'people.staff.attendance.cartrack_mapping';
