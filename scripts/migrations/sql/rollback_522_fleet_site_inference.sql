-- rollback_522_fleet_site_inference.sql
-- Drops the site-inference proposal surface. Human decisions are lost with it,
-- so take a copy of fleet_site_inference_decisions before running this.
DROP VIEW IF EXISTS fleet_site_inference_proposals;
DROP TRIGGER IF EXISTS trg_fleet_site_inference_decision_guard
  ON fleet_site_inference_decisions;
DROP FUNCTION IF EXISTS fleet_site_inference_decision_guard();
DROP TABLE IF EXISTS fleet_site_inference_decisions;
DROP TABLE IF EXISTS fleet_site_inference_evidence;
DELETE FROM schema_migrations WHERE filename = '522_fleet_site_inference.sql';
