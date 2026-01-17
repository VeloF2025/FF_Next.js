-- Migration: 070_sage_integration
-- Sage Business Cloud Accounting Integration
-- Created: 2026-01-17
-- Description: Add tables for bidirectional sync with Sage Accounting (South Africa)

-- ============================================
-- 1. Sage API Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS sage_api_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- API Credentials
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    company_id TEXT NOT NULL,

    -- OAuth tokens (encrypted at rest via application layer)
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,

    -- Configuration
    environment VARCHAR(20) DEFAULT 'production' CHECK (environment IN ('production', 'sandbox')),
    base_url TEXT DEFAULT 'https://accounting.sageone.co.za',
    api_version VARCHAR(10) DEFAULT '2.0.0',

    -- Rate limiting
    requests_per_minute INTEGER DEFAULT 60,
    last_request_at TIMESTAMP WITH TIME ZONE,

    -- Sync settings
    sync_enabled BOOLEAN DEFAULT true,
    sync_interval_minutes INTEGER DEFAULT 15,
    last_full_sync_at TIMESTAMP WITH TIME ZONE,

    -- Status
    connection_status VARCHAR(30) DEFAULT 'disconnected' CHECK (connection_status IN ('connected', 'disconnected', 'error', 'expired')),
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. Sage Sync Queue (follows onemap_sync_queue pattern)
-- ============================================
CREATE TABLE IF NOT EXISTS sage_sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Entity reference
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('purchase_order', 'supplier', 'invoice', 'payment')),
    entity_id UUID NOT NULL,
    entity_number VARCHAR(100),

    -- Sync direction
    sync_direction VARCHAR(20) NOT NULL CHECK (sync_direction IN ('push_to_sage', 'pull_from_sage')),

    -- Operation details
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

    -- Status tracking
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry', 'cancelled')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,

    -- Error handling
    last_error TEXT,
    last_error_code VARCHAR(50),

    -- Payload
    request_payload JSONB,
    response_payload JSONB,

    -- Timing
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_sync_queue_status ON sage_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sage_sync_queue_scheduled ON sage_sync_queue(scheduled_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_sage_sync_queue_entity ON sage_sync_queue(entity_type, entity_id);

-- ============================================
-- 3. Entity ID Mappings (FibreFlow <-> Sage)
-- ============================================
CREATE TABLE IF NOT EXISTS sage_entity_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FibreFlow side
    ff_entity_type VARCHAR(50) NOT NULL CHECK (ff_entity_type IN ('supplier', 'purchase_order', 'budget_category', 'product')),
    ff_entity_id VARCHAR(100) NOT NULL,

    -- Sage side
    sage_entity_type VARCHAR(50) NOT NULL CHECK (sage_entity_type IN ('Supplier', 'PurchaseOrder', 'Account', 'Item')),
    sage_entity_id VARCHAR(100) NOT NULL,

    -- Sync metadata
    last_synced_at TIMESTAMP WITH TIME ZONE,
    last_sync_checksum VARCHAR(64),
    sync_status VARCHAR(20) DEFAULT 'active' CHECK (sync_status IN ('active', 'orphaned', 'archived')),

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique mappings
    CONSTRAINT unique_ff_entity UNIQUE (ff_entity_type, ff_entity_id),
    CONSTRAINT unique_sage_entity UNIQUE (sage_entity_type, sage_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sage_mappings_ff ON sage_entity_mappings(ff_entity_type, ff_entity_id);
CREATE INDEX IF NOT EXISTS idx_sage_mappings_sage ON sage_entity_mappings(sage_entity_type, sage_entity_id);

-- ============================================
-- 4. GL Account Mappings (Budget Category -> Sage Account)
-- ============================================
CREATE TABLE IF NOT EXISTS sage_gl_account_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Budget category reference
    budget_category_code VARCHAR(50) NOT NULL UNIQUE,
    budget_category_name VARCHAR(255),

    -- Sage GL Account
    sage_account_id VARCHAR(100),
    sage_account_code VARCHAR(50),
    sage_account_name VARCHAR(255),
    sage_account_category VARCHAR(100),

    -- Tax settings
    default_tax_type_id VARCHAR(100),
    default_tax_type_name VARCHAR(100),
    default_tax_rate DECIMAL(5,2) DEFAULT 15.00,

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_mapped BOOLEAN DEFAULT false,

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default budget category mappings (unmapped initially)
INSERT INTO sage_gl_account_mappings (budget_category_code, budget_category_name, sage_account_category, is_mapped)
VALUES
    ('MATERIALS', 'Materials & Consumables', 'Expense', false),
    ('EQUIPMENT', 'Equipment & Tools', 'Expense', false),
    ('LABOR', 'Labor Costs', 'Expense', false),
    ('SUBCONTRACT', 'Subcontractor Work', 'Expense', false),
    ('TRANSPORT', 'Transport & Logistics', 'Expense', false),
    ('OVERHEAD', 'Overhead & Admin', 'Expense', false),
    ('CONTINGENCY', 'Contingency Reserve', 'Expense', false),
    ('CABLES', 'Cables & Fiber', 'Expense', false),
    ('ENCLOSURES', 'Enclosures & Joints', 'Expense', false),
    ('POLES', 'Poles & Structures', 'Expense', false),
    ('HARDWARE', 'Hardware & Fittings', 'Expense', false),
    ('SPLICING', 'Splicing & Connectivity', 'Expense', false),
    ('CIVIL', 'Civil Works & Ducting', 'Expense', false),
    ('HOME_CONNECTION', 'Home Connection', 'Expense', false),
    ('CONSUMABLES', 'Consumables & Sundries', 'Expense', false)
ON CONFLICT (budget_category_code) DO NOTHING;

-- ============================================
-- 5. Sage Supplier Invoices (pulled from Sage)
-- ============================================
CREATE TABLE IF NOT EXISTS sage_supplier_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sage reference
    sage_invoice_id VARCHAR(100) UNIQUE NOT NULL,
    sage_supplier_id VARCHAR(100),

    -- FibreFlow links
    supplier_id INTEGER REFERENCES suppliers(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    grn_id UUID REFERENCES goods_receipt_notes(id),

    -- Invoice details
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,
    reference VARCHAR(255),

    -- Amounts
    subtotal DECIMAL(15,2),
    tax_amount DECIMAL(15,2),
    total_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Payment tracking
    amount_paid DECIMAL(15,2) DEFAULT 0,
    balance_outstanding DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,

    -- Status
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled', 'disputed')),
    sage_status VARCHAR(50),

    -- Matching
    matching_status VARCHAR(30) DEFAULT 'unmatched' CHECK (matching_status IN ('unmatched', 'partial', 'matched', 'disputed')),
    matching_notes TEXT,
    matched_at TIMESTAMP WITH TIME ZONE,
    matched_by VARCHAR(255),

    -- Line items (stored as JSONB for flexibility)
    line_items JSONB,

    -- Audit
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_invoices_supplier ON sage_supplier_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_po ON sage_supplier_invoices(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_status ON sage_supplier_invoices(status);
CREATE INDEX IF NOT EXISTS idx_sage_invoices_matching ON sage_supplier_invoices(matching_status);

-- ============================================
-- 6. Sage Supplier Payments (pulled from Sage)
-- ============================================
CREATE TABLE IF NOT EXISTS sage_supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sage reference
    sage_payment_id VARCHAR(100) UNIQUE NOT NULL,
    sage_invoice_id VARCHAR(100),

    -- FibreFlow links
    supplier_id INTEGER REFERENCES suppliers(id),
    sage_invoice_ref UUID REFERENCES sage_supplier_invoices(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),

    -- Payment details
    payment_date DATE NOT NULL,
    reference VARCHAR(255),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Bank details
    bank_account_name VARCHAR(255),
    payment_method VARCHAR(50),

    -- Status
    status VARCHAR(30) DEFAULT 'processed' CHECK (status IN ('pending', 'processed', 'reconciled', 'reversed')),
    sage_status VARCHAR(50),

    -- Audit
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_payments_supplier ON sage_supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sage_payments_invoice ON sage_supplier_payments(sage_invoice_ref);
CREATE INDEX IF NOT EXISTS idx_sage_payments_po ON sage_supplier_payments(purchase_order_id);

-- ============================================
-- 7. Sage Sync History (Audit Log)
-- ============================================
CREATE TABLE IF NOT EXISTS sage_sync_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sync job details
    sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('full', 'incremental', 'single_entity', 'scheduled', 'manual')),
    sync_direction VARCHAR(20) NOT NULL CHECK (sync_direction IN ('push_to_sage', 'pull_from_sage', 'bidirectional')),

    -- Scope
    entity_type VARCHAR(50),
    entity_id UUID,

    -- Results
    status VARCHAR(30) NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'partial', 'cancelled')),
    records_processed INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,

    -- Error details
    errors JSONB,

    -- Timing
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,

    -- Audit
    triggered_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sage_sync_history_type ON sage_sync_history(sync_type);
CREATE INDEX IF NOT EXISTS idx_sage_sync_history_status ON sage_sync_history(status);
CREATE INDEX IF NOT EXISTS idx_sage_sync_history_started ON sage_sync_history(started_at DESC);

-- ============================================
-- 8. Add Sage columns to existing tables
-- ============================================

-- Add to suppliers table
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sage_supplier_id VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sage_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sage_sync_status VARCHAR(20) DEFAULT 'pending' CHECK (sage_sync_status IN ('pending', 'synced', 'failed', 'not_applicable'));
CREATE INDEX IF NOT EXISTS idx_suppliers_sage_id ON suppliers(sage_supplier_id) WHERE sage_supplier_id IS NOT NULL;

-- Add to purchase_orders table
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sage_po_id VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sage_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sage_sync_status VARCHAR(20) DEFAULT 'pending' CHECK (sage_sync_status IN ('pending', 'synced', 'failed', 'not_applicable'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sage_sync_error TEXT;
CREATE INDEX IF NOT EXISTS idx_po_sage_id ON purchase_orders(sage_po_id) WHERE sage_po_id IS NOT NULL;

-- Add Sage reference columns to budget_transactions
ALTER TABLE budget_transactions ADD COLUMN IF NOT EXISTS sage_invoice_id VARCHAR(100);
ALTER TABLE budget_transactions ADD COLUMN IF NOT EXISTS sage_payment_id VARCHAR(100);

-- ============================================
-- 9. Trigger: Queue PO sync on approval
-- ============================================
CREATE OR REPLACE FUNCTION queue_sage_po_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- Only queue if status changed to approved and Sage sync not already done
    IF NEW.status = 'approved'
       AND (OLD.status IS NULL OR OLD.status != 'approved')
       AND (NEW.sage_sync_status IS NULL OR NEW.sage_sync_status = 'pending') THEN

        -- Check if Sage integration is enabled
        IF EXISTS (SELECT 1 FROM sage_api_config WHERE sync_enabled = true AND connection_status = 'connected' LIMIT 1) THEN
            INSERT INTO sage_sync_queue (
                entity_type,
                entity_id,
                entity_number,
                sync_direction,
                operation,
                priority,
                request_payload
            ) VALUES (
                'purchase_order',
                NEW.id,
                NEW.po_number,
                'push_to_sage',
                'create',
                3,
                jsonb_build_object(
                    'po_number', NEW.po_number,
                    'supplier_id', NEW.supplier_id,
                    'total_amount', NEW.total_amount,
                    'project_id', NEW.project_id,
                    'tax_amount', NEW.tax_amount
                )
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_queue_sage_po_sync ON purchase_orders;
CREATE TRIGGER trg_queue_sage_po_sync
    AFTER UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION queue_sage_po_sync();

-- ============================================
-- 10. Trigger: Update budget on Sage invoice sync
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_on_sage_invoice()
RETURNS TRIGGER AS $$
DECLARE
    v_budget RECORD;
    v_po RECORD;
BEGIN
    -- Only process approved invoices matched to a PO
    IF NEW.purchase_order_id IS NOT NULL AND NEW.status = 'approved' AND NEW.matching_status = 'matched' THEN
        -- Get PO
        SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.purchase_order_id;

        IF v_po IS NULL THEN RETURN NEW; END IF;

        -- Get budget
        SELECT * INTO v_budget FROM project_budgets WHERE project_id = v_po.project_id;

        IF v_budget IS NULL THEN RETURN NEW; END IF;

        -- Check if transaction already exists
        IF NOT EXISTS (
            SELECT 1 FROM budget_transactions
            WHERE sage_invoice_id = NEW.sage_invoice_id
        ) THEN
            -- Create invoice transaction
            INSERT INTO budget_transactions (
                project_budget_id,
                category_id,
                transaction_type,
                source_type,
                source_id,
                source_number,
                amount,
                tax_amount,
                description,
                sage_invoice_id,
                created_by
            ) VALUES (
                v_budget.id,
                v_po.budget_category_id,
                'invoice',
                'sage_supplier_invoice',
                NEW.id,
                NEW.invoice_number,
                NEW.total_amount,
                COALESCE(NEW.tax_amount, 0),
                'Sage Invoice: ' || NEW.invoice_number,
                NEW.sage_invoice_id,
                'sage_sync'
            );

            -- Update PO invoiced amount
            UPDATE purchase_orders
            SET amount_invoiced = COALESCE(amount_invoiced, 0) + NEW.total_amount,
                updated_at = NOW()
            WHERE id = NEW.purchase_order_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_budget_sage_invoice ON sage_supplier_invoices;
CREATE TRIGGER trg_budget_sage_invoice
    AFTER INSERT OR UPDATE ON sage_supplier_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_on_sage_invoice();

-- ============================================
-- 11. Trigger: Update budget on Sage payment sync
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_on_sage_payment()
RETURNS TRIGGER AS $$
DECLARE
    v_invoice RECORD;
    v_budget RECORD;
    v_po RECORD;
BEGIN
    -- Only process new payments
    IF TG_OP = 'INSERT' THEN
        -- Get linked invoice
        SELECT * INTO v_invoice FROM sage_supplier_invoices WHERE id = NEW.sage_invoice_ref;

        IF v_invoice IS NULL OR v_invoice.purchase_order_id IS NULL THEN
            RETURN NEW;
        END IF;

        -- Get PO
        SELECT * INTO v_po FROM purchase_orders WHERE id = v_invoice.purchase_order_id;

        IF v_po IS NULL THEN RETURN NEW; END IF;

        -- Get budget
        SELECT * INTO v_budget FROM project_budgets WHERE project_id = v_po.project_id;

        IF v_budget IS NOT NULL THEN
            -- Create payment transaction
            INSERT INTO budget_transactions (
                project_budget_id,
                category_id,
                transaction_type,
                source_type,
                source_id,
                source_number,
                amount,
                description,
                sage_payment_id,
                created_by
            ) VALUES (
                v_budget.id,
                v_po.budget_category_id,
                'payment',
                'sage_supplier_payment',
                NEW.id,
                NEW.reference,
                NEW.amount,
                'Sage Payment: ' || COALESCE(NEW.reference, NEW.sage_payment_id),
                NEW.sage_payment_id,
                'sage_sync'
            );
        END IF;

        -- Update PO paid amount
        UPDATE purchase_orders
        SET amount_paid = COALESCE(amount_paid, 0) + NEW.amount,
            updated_at = NOW()
        WHERE id = v_invoice.purchase_order_id;

        -- Update invoice paid amount
        UPDATE sage_supplier_invoices
        SET amount_paid = COALESCE(amount_paid, 0) + NEW.amount,
            status = CASE
                WHEN COALESCE(amount_paid, 0) + NEW.amount >= total_amount THEN 'paid'
                ELSE status
            END,
            updated_at = NOW()
        WHERE id = NEW.sage_invoice_ref;

        -- Check if PO is fully paid
        IF (SELECT COALESCE(amount_paid, 0) FROM purchase_orders WHERE id = v_invoice.purchase_order_id) >= v_po.total_amount THEN
            UPDATE purchase_orders
            SET status = 'paid',
                updated_at = NOW()
            WHERE id = v_invoice.purchase_order_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_budget_sage_payment ON sage_supplier_payments;
CREATE TRIGGER trg_budget_sage_payment
    AFTER INSERT ON sage_supplier_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_on_sage_payment();

-- ============================================
-- 12. Function: Check Sage connection status
-- ============================================
CREATE OR REPLACE FUNCTION check_sage_connection_status()
RETURNS TABLE (
    is_connected BOOLEAN,
    connection_status VARCHAR(30),
    last_sync TIMESTAMP WITH TIME ZONE,
    pending_queue_items INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (c.connection_status = 'connected') AS is_connected,
        c.connection_status,
        c.last_full_sync_at AS last_sync,
        (SELECT COUNT(*)::INTEGER FROM sage_sync_queue WHERE status IN ('pending', 'retry')) AS pending_queue_items
    FROM sage_api_config c
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Sage Integration Migration Complete ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - sage_api_config';
    RAISE NOTICE '  - sage_sync_queue';
    RAISE NOTICE '  - sage_entity_mappings';
    RAISE NOTICE '  - sage_gl_account_mappings (15 categories seeded)';
    RAISE NOTICE '  - sage_supplier_invoices';
    RAISE NOTICE '  - sage_supplier_payments';
    RAISE NOTICE '  - sage_sync_history';
    RAISE NOTICE '';
    RAISE NOTICE 'Columns added:';
    RAISE NOTICE '  - suppliers: sage_supplier_id, sage_synced_at, sage_sync_status';
    RAISE NOTICE '  - purchase_orders: sage_po_id, sage_synced_at, sage_sync_status, sage_sync_error';
    RAISE NOTICE '  - budget_transactions: sage_invoice_id, sage_payment_id';
    RAISE NOTICE '';
    RAISE NOTICE 'Triggers created:';
    RAISE NOTICE '  - trg_queue_sage_po_sync (auto-queue PO on approval)';
    RAISE NOTICE '  - trg_budget_sage_invoice (update budget on invoice sync)';
    RAISE NOTICE '  - trg_budget_sage_payment (update budget on payment sync)';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Configure Sage API credentials via /settings/sage';
    RAISE NOTICE '  2. Map GL accounts to budget categories';
    RAISE NOTICE '  3. Map existing suppliers to Sage contacts';
    RAISE NOTICE '  4. Enable sync in sage_api_config';
    RAISE NOTICE '';
END$$;
