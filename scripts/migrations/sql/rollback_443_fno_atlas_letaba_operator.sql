-- Rollback 443: remove the Letaba Networks operator
-- Removes the operator seeded by 443. fno_atlas_presence_points.operator_id and
-- fno_atlas_sources.operator_id both ON DELETE CASCADE, so any ingested Letaba
-- presence points and their source row go with it. Ingestion runs are retained
-- (source_id is ON DELETE SET NULL) as an audit trail.

DELETE FROM fno_atlas_operators WHERE slug = 'letaba';
