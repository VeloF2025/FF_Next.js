DELETE FROM role_permissions WHERE permission_key = 'construction-qa.works-qa.auto-sort';
DELETE FROM access_permissions WHERE key = 'construction-qa.works-qa.auto-sort';
DELETE FROM migrations WHERE version = '369';
