-- Rollback for 437_maintenance_step_photos.sql
-- WARNING: any per-slot photo data will be lost.

DROP INDEX IF EXISTS idx_maintenance_step_photos_actor;
DROP INDEX IF EXISTS idx_maintenance_step_photos_step;
DROP INDEX IF EXISTS idx_maintenance_step_photos_step_slot;

DROP TABLE IF EXISTS maintenance_step_photos;
