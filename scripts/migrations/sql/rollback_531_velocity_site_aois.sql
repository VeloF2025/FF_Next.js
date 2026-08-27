-- Rollback for 531_velocity_site_aois.sql
--
-- Drops the refresh function and every AOI it owns, then the source row.
--
-- Order matters: the rows carry an FK to the source, and an operational site
-- may carry an FK to a row. A site that references one of these AOIs is a
-- deliberate blocker — rolling this back would leave that site pointing at
-- geometry that no longer exists, so the DELETE is scoped to unreferenced
-- rows and referenced ones are retired instead. If any survive, the source row
-- survives with them (ON DELETE SET NULL would otherwise orphan them into the
-- ingest's uniqueness slot).

DROP FUNCTION IF EXISTS refresh_velocity_site_aois();

UPDATE fno_atlas_project_aois a
   SET retired_at = NOW(), updated_at = NOW()
 WHERE a.retired_at IS NULL
   AND a.source_id = (SELECT id FROM fno_atlas_sources WHERE source_url = 'fibreflow://project_aois')
   AND EXISTS (SELECT 1 FROM fleet_project_operational_sites s WHERE s.project_aoi_id = a.id);

DELETE FROM fno_atlas_project_aois a
 WHERE a.source_id = (SELECT id FROM fno_atlas_sources WHERE source_url = 'fibreflow://project_aois')
   AND NOT EXISTS (SELECT 1 FROM fleet_project_operational_sites s WHERE s.project_aoi_id = a.id);

DELETE FROM fno_atlas_sources s
 WHERE s.source_url = 'fibreflow://project_aois'
   AND NOT EXISTS (SELECT 1 FROM fno_atlas_project_aois a WHERE a.source_id = s.id);

DELETE FROM schema_migrations WHERE filename = '531_velocity_site_aois.sql';
