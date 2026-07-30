-- Rollback migration 470.
-- Destructive: removes Zone Delivery projections and their audit evidence.
-- Execute only after reverting every application caller. The automated test
-- suite exercises this file solely against its Docker database.

BEGIN;

DROP TABLE IF EXISTS zone_delivery_activity;
DROP TABLE IF EXISTS zone_delivery_snag_links;
DROP TABLE IF EXISTS zone_delivery_documents;
DROP TABLE IF EXISTS pon_delivery_state;
DROP TABLE IF EXISTS zone_delivery_state;

DROP FUNCTION IF EXISTS reject_zone_delivery_activity_mutation();
DROP FUNCTION IF EXISTS protect_zone_delivery_handover();

DELETE FROM user_permission_overrides
WHERE permission_key LIKE 'construction-qa.zone-delivery.%';

DELETE FROM role_permissions
WHERE permission_key LIKE 'construction-qa.zone-delivery.%';

DELETE FROM access_permissions
WHERE key IN (
  'construction-qa.zone-delivery.scope-manage',
  'construction-qa.zone-delivery.construction-confirm',
  'construction-qa.zone-delivery.testing-confirm',
  'construction-qa.zone-delivery.operations-confirm',
  'construction-qa.zone-delivery.zone-qa-approve',
  'construction-qa.zone-delivery.documents-manage'
);

DELETE FROM schema_migrations
WHERE filename = '470_zone_delivery_handover.sql';

COMMIT;
