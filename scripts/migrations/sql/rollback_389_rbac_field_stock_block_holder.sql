-- Rollback 389: remove the procurement.field-stock.block-holder RBAC permission
--
-- NOTE: this only removes the RBAC catalogue entry + role grants. The
-- withPermission() gate on the block/unblock routes must be reverted in code
-- separately, otherwise those routes will 403 every non-super_admin caller
-- (withPermission denies when the permission key is absent).

BEGIN;

DELETE FROM role_permissions   WHERE permission_key = 'procurement.field-stock.block-holder';
DELETE FROM access_permissions WHERE key            = 'procurement.field-stock.block-holder';
DELETE FROM migrations         WHERE version        = '389';

COMMIT;
