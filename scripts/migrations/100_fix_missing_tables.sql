-- Migration 100: Fix Missing Tables
-- Purpose: Create missing tables that are referenced by existing FKs
-- Date: 2026-01-20
--
-- Issues Fixed:
-- 1. purchase_orders.quote_id references quotes(id) but quotes table doesn't exist
-- 2. stock_levels.warehouse_id references warehouses(id) but only stock_locations exists

-- ============================================================================
-- 1. QUOTES TABLE
-- Formal supplier quotes (can be from RFQ responses or standalone)
-- ============================================================================

CREATE TABLE IF NOT EXISTS quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number VARCHAR(50) UNIQUE NOT NULL,

    -- Source linkage (optional - quote can be standalone or from RFQ)
    rfq_id UUID REFERENCES rfqs(id),
    rfq_response_id UUID REFERENCES rfq_responses(id),

    -- Supplier
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    supplier_name VARCHAR(255),
    supplier_contact VARCHAR(255),
    supplier_email VARCHAR(255),

    -- Context
    project_id UUID REFERENCES projects(id),

    -- Quote details
    title VARCHAR(255),
    description TEXT,
    reference_number VARCHAR(100), -- Supplier's quote reference

    -- Dates
    quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_until DATE,

    -- Status: draft, submitted, under_review, approved, rejected, expired, converted
    status VARCHAR(30) DEFAULT 'submitted' CHECK (status IN (
        'draft', 'submitted', 'under_review', 'approved', 'rejected', 'expired', 'converted'
    )),

    -- Financials
    currency VARCHAR(3) DEFAULT 'ZAR',
    subtotal DECIMAL(14,2),
    tax_rate DECIMAL(5,2) DEFAULT 15.00,
    tax_amount DECIMAL(14,2),
    discount_amount DECIMAL(12,2) DEFAULT 0,
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(14,2),

    -- Terms
    payment_terms VARCHAR(100),
    delivery_terms TEXT,
    delivery_days INTEGER,
    warranty_terms TEXT,

    -- Evaluation
    evaluation_score DECIMAL(5,2),
    evaluation_notes TEXT,
    evaluated_by VARCHAR(255),
    evaluated_at TIMESTAMP WITH TIME ZONE,

    -- Conversion tracking
    converted_to_po_id UUID, -- Will be updated when PO is created
    converted_at TIMESTAMP WITH TIME ZONE,
    converted_by VARCHAR(255),

    -- Attachments and notes
    attachments JSONB DEFAULT '[]',
    internal_notes TEXT,
    supplier_notes TEXT,

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quotes_supplier ON quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);
CREATE INDEX IF NOT EXISTS idx_quotes_rfq ON quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_valid_until ON quotes(valid_until);
CREATE INDEX IF NOT EXISTS idx_quotes_date ON quotes(quote_date);

-- ============================================================================
-- QUOTE ITEMS TABLE
-- Line items for quotes
-- ============================================================================

CREATE TABLE IF NOT EXISTS quote_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

    -- Item reference
    rfq_item_id UUID REFERENCES rfq_items(id),
    stock_item_id UUID REFERENCES stock_items(id),
    boq_item_id UUID REFERENCES boq_items(id),

    -- Item details
    line_number INTEGER NOT NULL,
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,
    specifications TEXT,

    -- Quantities
    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,

    -- Pricing
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_rate DECIMAL(5,2),
    tax_amount DECIMAL(12,2),
    line_total DECIMAL(14,2),

    -- Delivery
    lead_time_days INTEGER,
    availability_status VARCHAR(50), -- in_stock, on_order, make_to_order

    -- Alternative offering
    is_alternative BOOLEAN DEFAULT false,
    original_item_id UUID REFERENCES quote_items(id),
    alternative_reason TEXT,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_quote_line UNIQUE(quote_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_rfq_item ON quote_items(rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_stock_item ON quote_items(stock_item_id);

-- ============================================================================
-- 2. WAREHOUSES VIEW (Alias for stock_locations with type='warehouse')
-- This provides backwards compatibility for code expecting a warehouses table
-- ============================================================================

CREATE OR REPLACE VIEW warehouses AS
SELECT
    id,
    code,
    name,
    address,
    coordinates,
    project_id,
    is_active,
    created_at,
    updated_at,
    created_by
FROM stock_locations
WHERE location_type = 'warehouse';

COMMENT ON VIEW warehouses IS 'View of stock_locations filtered to warehouse type - for backwards compatibility';

-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================

-- Auto-generate quote number
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TRIGGER AS $$
DECLARE
    year_suffix VARCHAR(2);
    next_num INTEGER;
BEGIN
    IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
        year_suffix := TO_CHAR(NOW(), 'YY');

        SELECT COALESCE(MAX(
            CAST(SUBSTRING(quote_number FROM 4) AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM quotes
        WHERE quote_number LIKE 'Q' || year_suffix || '%';

        NEW.quote_number := 'Q' || year_suffix || '-' || LPAD(next_num::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_quote_number ON quotes;
CREATE TRIGGER tr_quote_number
    BEFORE INSERT ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION generate_quote_number();

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_quote_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_quote_updated_at ON quotes;
CREATE TRIGGER tr_quote_updated_at
    BEFORE UPDATE ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION update_quote_updated_at();

-- Calculate quote item line total
CREATE OR REPLACE FUNCTION calculate_quote_item_total()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate line total with discount
    NEW.line_total := NEW.quantity * NEW.unit_price * (1 - COALESCE(NEW.discount_percent, 0) / 100);

    -- Calculate tax if rate provided
    IF NEW.tax_rate IS NOT NULL THEN
        NEW.tax_amount := NEW.line_total * NEW.tax_rate / 100;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_quote_item_calc ON quote_items;
CREATE TRIGGER tr_quote_item_calc
    BEFORE INSERT OR UPDATE ON quote_items
    FOR EACH ROW
    EXECUTE FUNCTION calculate_quote_item_total();

-- Update quote totals when items change
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_subtotal DECIMAL(14,2);
    v_tax DECIMAL(14,2);
    v_quote_id UUID;
BEGIN
    v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

    SELECT
        COALESCE(SUM(line_total), 0),
        COALESCE(SUM(tax_amount), 0)
    INTO v_subtotal, v_tax
    FROM quote_items
    WHERE quote_id = v_quote_id;

    UPDATE quotes
    SET
        subtotal = v_subtotal,
        tax_amount = v_tax,
        total_amount = v_subtotal + v_tax + COALESCE(shipping_cost, 0) - COALESCE(discount_amount, 0)
    WHERE id = v_quote_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_quote_totals ON quote_items;
CREATE TRIGGER tr_quote_totals
    AFTER INSERT OR UPDATE OR DELETE ON quote_items
    FOR EACH ROW
    EXECUTE FUNCTION update_quote_totals();

-- ============================================================================
-- 4. FIX STOCK_LEVELS FK (Change from warehouses to stock_locations)
-- ============================================================================

-- Drop the broken FK constraint if it exists
ALTER TABLE stock_levels
DROP CONSTRAINT IF EXISTS stock_levels_warehouse_id_fkey;

-- Rename column to location_id for clarity (optional, but cleaner)
-- Note: This may fail if column doesn't exist yet - that's OK
DO $$
BEGIN
    -- Check if warehouse_id exists and location_id doesn't
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_levels' AND column_name = 'warehouse_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_levels' AND column_name = 'location_id'
    ) THEN
        -- Add new location_id column
        ALTER TABLE stock_levels ADD COLUMN location_id UUID REFERENCES stock_locations(id);

        -- Copy data from warehouse_id to location_id
        UPDATE stock_levels SET location_id = warehouse_id;

        -- Drop old warehouse_id column
        ALTER TABLE stock_levels DROP COLUMN warehouse_id;
    END IF;
EXCEPTION
    WHEN others THEN
        -- Table might not exist yet, that's OK
        RAISE NOTICE 'stock_levels migration skipped: %', SQLERRM;
END;
$$;

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON TABLE quotes IS 'Supplier quotes - can be from RFQ responses or standalone';
COMMENT ON TABLE quote_items IS 'Line items for supplier quotes';
COMMENT ON COLUMN quotes.status IS 'Workflow: draft → submitted → under_review → approved/rejected → converted';
COMMENT ON COLUMN quotes.converted_to_po_id IS 'Reference to PO created from this quote';
COMMENT ON COLUMN quote_items.is_alternative IS 'True if this is an alternative item offered by supplier';

-- ============================================================================
-- 6. HELPER FUNCTION: Create quote from RFQ response
-- ============================================================================

CREATE OR REPLACE FUNCTION create_quote_from_rfq_response(p_response_id UUID)
RETURNS UUID AS $$
DECLARE
    v_quote_id UUID;
    v_response RECORD;
BEGIN
    -- Get the RFQ response
    SELECT * INTO v_response FROM rfq_responses WHERE id = p_response_id;

    IF v_response IS NULL THEN
        RAISE EXCEPTION 'RFQ response not found: %', p_response_id;
    END IF;

    -- Create the quote
    INSERT INTO quotes (
        rfq_id,
        rfq_response_id,
        supplier_id,
        supplier_name,
        project_id,
        title,
        quote_date,
        valid_until,
        status,
        currency,
        total_amount,
        payment_terms,
        delivery_terms,
        evaluation_score,
        evaluation_notes,
        created_by
    )
    SELECT
        v_response.rfq_id,
        v_response.id,
        v_response.supplier_id::INTEGER,
        v_response.supplier_name,
        r.project_id,
        'Quote from ' || v_response.supplier_name,
        v_response.submission_date::DATE,
        v_response.submission_date::DATE + v_response.validity_period,
        CASE
            WHEN v_response.status = 'accepted' THEN 'approved'
            WHEN v_response.status = 'rejected' THEN 'rejected'
            ELSE 'under_review'
        END,
        v_response.currency,
        v_response.total_amount,
        v_response.payment_terms,
        v_response.delivery_terms,
        v_response.evaluation_score,
        v_response.evaluation_notes,
        'system'
    FROM rfqs r
    WHERE r.id = v_response.rfq_id
    RETURNING id INTO v_quote_id;

    -- Copy line items
    INSERT INTO quote_items (
        quote_id,
        rfq_item_id,
        line_number,
        item_code,
        item_description,
        quantity,
        uom,
        unit_price,
        discount_percent,
        lead_time_days
    )
    SELECT
        v_quote_id,
        rri.rfq_item_id,
        ROW_NUMBER() OVER (ORDER BY rri.id),
        ri.item_code,
        ri.description,
        ri.quantity,
        COALESCE(ri.uom, 'EA'),
        rri.unit_price,
        rri.discount_percent,
        rri.delivery_days
    FROM rfq_response_items rri
    JOIN rfq_items ri ON ri.id = rri.rfq_item_id
    WHERE rri.response_id = p_response_id;

    RETURN v_quote_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_quote_from_rfq_response IS 'Creates a quote record from an existing RFQ response';
