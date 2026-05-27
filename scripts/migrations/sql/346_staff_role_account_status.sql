-- 346_staff_role_account_status.sql
-- Adds role (functional role within FibreFlow) and account_status (lifecycle of the /my account).
-- Distinct from staff.status (employment) and staff.contract_type (HR classification).
-- Sets up the foundation for stores-initiated technician onboarding (PWA Phase 2).

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IS NULL OR role IN ('technician','stores','supervisor','admin','driver','office'));

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending','active','suspended'));

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS created_by_staff_id UUID REFERENCES staff(id);

-- Speeds up "show me pending users to approve" queries.
CREATE INDEX IF NOT EXISTS staff_account_status_role_idx
  ON staff (account_status, role)
  WHERE account_status = 'pending';

COMMENT ON COLUMN staff.role IS
  'Functional role for /my PWA gating: technician, stores, supervisor, admin, driver, office. NULL = legacy office staff before this migration.';

COMMENT ON COLUMN staff.account_status IS
  'PWA account lifecycle. pending = created by stores on the fly, awaiting admin approval; active = normal; suspended = admin blocked.';

COMMENT ON COLUMN staff.created_by_staff_id IS
  'When set, the staff member who created this record (e.g., stores person who onboarded a contractor technician on-the-fly).';

COMMIT;
