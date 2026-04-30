-- Rollback 330: remove Pulse Search permission

DELETE FROM role_permissions WHERE permission_key = 'people.staff.attendance.search';
DELETE FROM access_permissions WHERE key = 'people.staff.attendance.search';
