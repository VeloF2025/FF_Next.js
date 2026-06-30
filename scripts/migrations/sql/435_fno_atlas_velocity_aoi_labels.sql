-- Migration 435: Rename generated AOI wording and area kind away from external source branding.
-- The underlying source table remains internal system data; user-facing Atlas copy should say Velocity AOI.

ALTER TABLE fno_atlas_project_aois
  DROP CONSTRAINT IF EXISTS fno_atlas_project_aois_area_kind_check;

ALTER TABLE fno_atlas_project_aois
  ALTER COLUMN area_kind SET DEFAULT 'velocity_site_aoi';

UPDATE fno_atlas_project_aois
   SET area_kind = 'velocity_site_aoi',
       raw_properties = jsonb_set(
         jsonb_set(
           raw_properties,
           '{label}',
           to_jsonb('Velocity AOI - not official FNO-published coverage'::text),
           true
         ),
         '{sourceTable}',
         to_jsonb('internal_gps_properties'::text),
         true
       ),
       updated_at = NOW()
 WHERE area_kind = 'onemap_site_aoi';

UPDATE fno_atlas_project_aois
   SET raw_properties = jsonb_set(
         raw_properties,
         '{sourceTable}',
         to_jsonb('internal_gps_properties'::text),
         true
       ),
       updated_at = NOW()
 WHERE raw_properties->>'sourceTable' = 'onemap_properties';

ALTER TABLE fno_atlas_project_aois
  ADD CONSTRAINT fno_atlas_project_aois_area_kind_check
  CHECK (area_kind IN ('velocity_site_aoi'));

UPDATE fno_atlas_sources
   SET source_name = 'Velocity internal area AOIs',
       terms_notes = 'Internal Velocity GPS-derived AOI polygons. Area-only layer; does not expose demand points and is not official FNO-published coverage.',
       updated_at = NOW()
 WHERE source_url = 'fibreflow://onemap_properties';

COMMENT ON TABLE fno_atlas_project_aois IS
  'Generated area-only Velocity AOI polygons for FNO Atlas. These are derived from internal GPS source data and must not be labelled as official FNO-published coverage.';

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('435_fno_atlas_velocity_aoi_labels.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
