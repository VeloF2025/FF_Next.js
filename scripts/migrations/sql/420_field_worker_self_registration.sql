-- Migration 420: self-registration capture columns + 'casual' role
--
-- Builds on migration 346 (staff.role, staff.account_status). Adds the fields a
-- self-registered field worker captures at sign-up, and extends the role CHECK
-- to allow 'casual'. A self-registered worker is a normal staff row with
-- account_status='pending' (existing lifecycle) — NO new status value.
--
-- Idempotent: safe to re-run.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS source              varchar(32) NOT NULL DEFAULT 'hr',
  ADD COLUMN IF NOT EXISTS declared_project_id uuid,
  ADD COLUMN IF NOT EXISTS id_number           varchar(32),
  ADD COLUMN IF NOT EXISTS selfie_url          text;

COMMENT ON COLUMN staff.source IS
  'Origin of the row: ''hr'' (default), ''self_registered'' (/my/register), or '
  '''stores'' (storeman-added technician). Drives HR-hiding (Slice B).';

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IS NULL OR role IN ('technician','casual','stores','supervisor','admin','driver','office'));
