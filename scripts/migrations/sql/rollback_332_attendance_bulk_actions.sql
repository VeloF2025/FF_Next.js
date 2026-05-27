-- Rollback 332: undo bulk_lock permission + audit table

DROP TABLE IF EXISTS attendance_bulk_action_audit;
DELETE FROM role_permissions WHERE permission_key = 'people.staff.attendance.bulk_lock';
DELETE FROM access_permissions WHERE key = 'people.staff.attendance.bulk_lock';
