-- Rollback 462: Seed 7 daily-equipment checklist templates
--
-- Deletes the 7 templates by category (items cascade via
-- hs_checklist_items_template_id_fkey ON DELETE CASCADE). Scoped to the
-- exact categories this migration created, so it can't touch the original 8.

BEGIN;

DELETE FROM hs_checklist_templates
WHERE category IN ('ladder', 'hand_tools', 'fire_equipment', 'road_cutter', 'compactor', 'barricading', 'traffic_signage');

DELETE FROM schema_migrations WHERE filename = '462_hs_equipment_checklist_seed.sql';

COMMIT;
