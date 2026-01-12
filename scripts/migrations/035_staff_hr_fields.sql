-- =====================================================
-- Migration 035: Staff HR Fields Expansion
-- Part of HR System Expansion (PRD-XXX)
-- =====================================================

-- Add CV upload fields
ALTER TABLE staff ADD COLUMN IF NOT EXISTS cv_url TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS cv_uploaded_at TIMESTAMPTZ;

-- Add company vehicle flag (triggers license requirement check in UI)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS has_company_vehicle BOOLEAN DEFAULT false;

-- Add bank details fields (if not using metadata JSONB)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_branch_code VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(20);

-- Add SA-specific ID fields
ALTER TABLE staff ADD COLUMN IF NOT EXISTS sa_id_number VARCHAR(13);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS passport_number VARCHAR(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS passport_country VARCHAR(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS passport_expiry DATE;

-- Add probation fields
ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_end_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_extended BOOLEAN DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_extension_reason TEXT;

-- Add notice period
ALTER TABLE staff ADD COLUMN IF NOT EXISTS notice_period_days INTEGER DEFAULT 30;

-- Add next of kin (separate from emergency contact)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS next_of_kin_name VARCHAR(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS next_of_kin_phone VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS next_of_kin_relationship VARCHAR(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS next_of_kin_address TEXT;

-- Add comments for documentation
COMMENT ON COLUMN staff.cv_url IS 'URL to uploaded CV/resume in VF Storage';
COMMENT ON COLUMN staff.cv_uploaded_at IS 'Timestamp when CV was last uploaded';
COMMENT ON COLUMN staff.has_company_vehicle IS 'Whether staff is assigned a company vehicle (triggers license requirement)';
COMMENT ON COLUMN staff.sa_id_number IS 'South African ID number (13 digits)';
COMMENT ON COLUMN staff.probation_end_date IS 'Date when probation period ends';
COMMENT ON COLUMN staff.notice_period_days IS 'Contractual notice period in days (default 30)';

-- =====================================================
-- Rollback (if needed)
-- =====================================================
-- ALTER TABLE staff DROP COLUMN IF EXISTS cv_url;
-- ALTER TABLE staff DROP COLUMN IF EXISTS cv_uploaded_at;
-- ALTER TABLE staff DROP COLUMN IF EXISTS has_company_vehicle;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_branch_code;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_account_type;
-- ALTER TABLE staff DROP COLUMN IF EXISTS sa_id_number;
-- ALTER TABLE staff DROP COLUMN IF EXISTS passport_number;
-- ALTER TABLE staff DROP COLUMN IF EXISTS passport_country;
-- ALTER TABLE staff DROP COLUMN IF EXISTS passport_expiry;
-- ALTER TABLE staff DROP COLUMN IF EXISTS probation_end_date;
-- ALTER TABLE staff DROP COLUMN IF EXISTS probation_extended;
-- ALTER TABLE staff DROP COLUMN IF EXISTS probation_extension_reason;
-- ALTER TABLE staff DROP COLUMN IF EXISTS notice_period_days;
-- ALTER TABLE staff DROP COLUMN IF EXISTS next_of_kin_name;
-- ALTER TABLE staff DROP COLUMN IF EXISTS next_of_kin_phone;
-- ALTER TABLE staff DROP COLUMN IF EXISTS next_of_kin_relationship;
-- ALTER TABLE staff DROP COLUMN IF EXISTS next_of_kin_address;
