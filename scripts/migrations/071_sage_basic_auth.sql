-- Migration: 071_sage_basic_auth
-- Update Sage integration to use Basic Auth (South Africa API)
-- Created: 2026-01-17
-- Description: South African Sage API uses Basic Auth + API key, not OAuth 2.0

-- ============================================
-- 1. Add Basic Auth columns to sage_api_config
-- ============================================

-- Add username for Basic Auth
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS username TEXT;

-- Add password for Basic Auth (encrypted at application layer)
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS password TEXT;

-- Add auth_type to distinguish between OAuth and Basic Auth
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS auth_type VARCHAR(20) DEFAULT 'basic'
CHECK (auth_type IN ('oauth', 'basic'));

-- Add is_active flag
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add is_connected flag (simpler than connection_status for basic auth)
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT false;

-- Add last sync and connection test timestamps
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS last_token_refresh_at TIMESTAMP WITH TIME ZONE;

-- Add redirect_uri for UI display
ALTER TABLE sage_api_config
ADD COLUMN IF NOT EXISTS redirect_uri TEXT;

-- ============================================
-- 2. Update column constraints
-- ============================================

-- Make client_secret nullable (not needed for Basic Auth display)
ALTER TABLE sage_api_config
ALTER COLUMN client_secret DROP NOT NULL;

-- Make created_by nullable
ALTER TABLE sage_api_config
ALTER COLUMN created_by DROP NOT NULL;

-- ============================================
-- 3. Add indexes for common queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sage_api_config_active
ON sage_api_config(is_active) WHERE is_active = true;

-- ============================================
-- 4. Update sage_sync_history for basic operations
-- ============================================

-- Add operation_type to allow more specific sync types
ALTER TABLE sage_sync_history
ADD COLUMN IF NOT EXISTS operation_type VARCHAR(50);

-- Add direction alias
ALTER TABLE sage_sync_history
ADD COLUMN IF NOT EXISTS direction VARCHAR(20);

-- Add error_message for simpler error tracking
ALTER TABLE sage_sync_history
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add details for full error context
ALTER TABLE sage_sync_history
ADD COLUMN IF NOT EXISTS details JSONB;

-- ============================================
-- 5. Update sage_supplier_payments for sync
-- ============================================

-- Add ff_purchase_order_id column
ALTER TABLE sage_supplier_invoices
ADD COLUMN IF NOT EXISTS ff_purchase_order_id UUID REFERENCES purchase_orders(id);

-- Add outstanding_amount for tracking
ALTER TABLE sage_supplier_invoices
ADD COLUMN IF NOT EXISTS outstanding_amount DECIMAL(15,2);

-- Add raw_data for debugging
ALTER TABLE sage_supplier_invoices
ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Add match_status to payments
ALTER TABLE sage_supplier_payments
ADD COLUMN IF NOT EXISTS match_status VARCHAR(30)
CHECK (match_status IN ('pending', 'matched', 'unmatched', 'manual'));

-- Add sage_invoice_id (text reference)
ALTER TABLE sage_supplier_payments
ADD COLUMN IF NOT EXISTS sage_invoice_id_ref VARCHAR(100);

-- Add raw_data for debugging
ALTER TABLE sage_supplier_payments
ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Sage Basic Auth Migration Complete ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Columns added to sage_api_config:';
    RAISE NOTICE '  - username (Basic Auth email)';
    RAISE NOTICE '  - password (Basic Auth password)';
    RAISE NOTICE '  - auth_type (oauth/basic)';
    RAISE NOTICE '  - is_active';
    RAISE NOTICE '  - is_connected';
    RAISE NOTICE '  - last_sync_at';
    RAISE NOTICE '  - last_connection_test_at';
    RAISE NOTICE '  - redirect_uri';
    RAISE NOTICE '';
    RAISE NOTICE 'The South African Sage API uses:';
    RAISE NOTICE '  - Basic Auth header: Authorization: Basic base64(username:password)';
    RAISE NOTICE '  - API key query param: ?apikey=your_api_key';
    RAISE NOTICE '';
    RAISE NOTICE 'client_id = API Key';
    RAISE NOTICE 'username = Sage account email';
    RAISE NOTICE 'password = Sage account password';
    RAISE NOTICE '';
END$$;
