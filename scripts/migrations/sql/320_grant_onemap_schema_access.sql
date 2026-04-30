-- Migration 301: Grant onemap schema access to fibreflow_user
--
-- Root cause: Supabase cutover (2026-04-18) created the onemap schema but did
-- not grant USAGE to the app role `fibreflow_user`. This broke every route
-- that queries onemap.* -- surfaced by NOC DR Lookup (ticket VF-20260424-024)
-- with "permission denied for schema onemap".
--
-- Affected call sites (confirmed by grep):
--   - src/modules/noc/services/drLookupService.ts (SELECT onemap.drops, onemap.projects)
--   - src/services/onemap/oneMapSyncService.ts (SELECT/INSERT/UPDATE on
--     onemap.drops, onemap.sites, onemap.sync_log)
--   - pages/api/onemap/* (multiple)
--
-- Scope: USAGE + full DML because the sync service writes. Read-only would
-- leave OneMap sync broken.

GRANT USAGE ON SCHEMA onemap TO fibreflow_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA onemap
  TO fibreflow_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA onemap
  TO fibreflow_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA onemap
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fibreflow_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA onemap
  GRANT USAGE, SELECT ON SEQUENCES TO fibreflow_user;
