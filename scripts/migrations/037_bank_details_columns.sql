-- =====================================================
-- Migration 037: Bank Details Columns
-- Adds explicit bank columns for OCR-extracted bank details
-- =====================================================

-- Add bank detail columns (if not already present)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_branch_code VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_account_holder VARCHAR(100);

-- Add verification timestamp for bank details
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_details_verified_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN staff.bank_name IS 'Bank name from OCR or manual entry';
COMMENT ON COLUMN staff.bank_account_number IS 'Bank account number from bank confirmation letter';
COMMENT ON COLUMN staff.bank_branch_code IS 'Bank branch/sort code';
COMMENT ON COLUMN staff.bank_account_type IS 'Account type: current, savings, transmission';
COMMENT ON COLUMN staff.bank_account_holder IS 'Account holder name from bank letter';
COMMENT ON COLUMN staff.bank_details_verified_at IS 'Timestamp when bank details were verified via document upload';

-- =====================================================
-- Rollback (if needed)
-- =====================================================
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_name;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_account_number;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_branch_code;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_account_type;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_account_holder;
-- ALTER TABLE staff DROP COLUMN IF EXISTS bank_details_verified_at;
