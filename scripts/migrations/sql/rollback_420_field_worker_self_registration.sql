-- Rollback for migration 420.
-- Restores the 346-era role CHECK (without 'casual') and drops the capture columns.
-- Safe only when no role='casual' rows exist (the re-added CHECK would reject them).

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IS NULL OR role IN ('technician','stores','supervisor','admin','driver','office'));

ALTER TABLE staff
  DROP COLUMN IF EXISTS selfie_url,
  DROP COLUMN IF EXISTS id_number,
  DROP COLUMN IF EXISTS declared_project_id,
  DROP COLUMN IF EXISTS source;
