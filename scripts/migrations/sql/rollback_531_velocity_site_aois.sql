-- Rollback for 531_velocity_site_aois.sql
--
-- Order matters. An operational site may point at one of these AOIs — the
-- migration repointed Lawley onto one deliberately — and the FK is NO ACTION,
-- so the link has to be moved off before the row can go.
--
--   1. Drop the function, so nothing re-creates rows underneath the rest.
--   2. Repoint any site pointing at a velocity AOI back onto the OneMap AOI
--      for the same project, matched by name. This is the inverse of the
--      migration's step (e). If no ingest AOI matches, the site keeps its
--      link and step 4 leaves that row alone rather than breaking the site.
--   3. Retire what is still referenced; delete the rest.
--   4. Drop the identity index and the source row, both only once nothing
--      depends on them.

DROP FUNCTION IF EXISTS refresh_velocity_site_aois();

UPDATE fleet_project_operational_sites s
   SET project_aoi_id = om.id,
       updated_at = NOW()
  FROM fno_atlas_project_aois v
  JOIN fno_atlas_sources vs
    ON vs.id = v.source_id AND vs.source_url = 'fibreflow://project_aois'
  JOIN projects pr ON pr.id::text = v.site_code
  JOIN fno_atlas_project_aois om
    ON om.retired_at IS NULL AND om.area_name = pr.project_name::text
  JOIN fno_atlas_sources oms
    ON oms.id = om.source_id AND oms.source_url = 'fibreflow://onemap_properties'
 WHERE s.project_aoi_id = v.id;

UPDATE fno_atlas_project_aois a
   SET retired_at = NOW(), updated_at = NOW()
 WHERE a.retired_at IS NULL
   AND a.source_id = (SELECT id FROM fno_atlas_sources WHERE source_url = 'fibreflow://project_aois')
   AND EXISTS (SELECT 1 FROM fleet_project_operational_sites s WHERE s.project_aoi_id = a.id);

DELETE FROM fno_atlas_project_aois a
 WHERE a.source_id = (SELECT id FROM fno_atlas_sources WHERE source_url = 'fibreflow://project_aois')
   AND NOT EXISTS (SELECT 1 FROM fleet_project_operational_sites s WHERE s.project_aoi_id = a.id);

DROP INDEX IF EXISTS ux_fno_atlas_velocity_site_aois_active_site;

DELETE FROM fno_atlas_sources s
 WHERE s.source_url = 'fibreflow://project_aois'
   AND NOT EXISTS (SELECT 1 FROM fno_atlas_project_aois a WHERE a.source_id = s.id);

DELETE FROM schema_migrations WHERE filename = '531_velocity_site_aois.sql';
