-- Migration: 062_material_catalog_budget_items
-- Description: Global material catalog and item-level budget tracking
-- Created: 2026-01-17
-- Related: BOQ Import & Budget Item Integration Plan

-- ============================================
-- 1. Create material_catalog table (Global Material Master)
-- ============================================
CREATE TABLE IF NOT EXISTS material_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Canonical identifier (from Item Code in BOQ)
    item_code VARCHAR(50) UNIQUE NOT NULL,

    -- Item details
    description TEXT NOT NULL,
    category VARCHAR(100),           -- BOQ Item Category (e.g., "Drop Cable (Connectorised)")
    budget_category VARCHAR(50) NOT NULL,  -- Fiber budget category code (e.g., "CABLES")
    uom VARCHAR(50),                 -- Unit of measure

    -- Pricing
    standard_rate DECIMAL(15,2),     -- Default/baseline rate

    -- Matching support
    keywords TEXT[],                 -- Extracted keywords for fuzzy matching
    normalized_description TEXT,     -- Lowercase, no special chars for matching

    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. Create material_suppliers table (Supplier-specific pricing)
-- ============================================
CREATE TABLE IF NOT EXISTS material_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    material_catalog_id UUID NOT NULL REFERENCES material_catalog(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,

    -- Supplier info (denormalized for when supplier_id is null)
    supplier_name VARCHAR(255),
    supplier_code VARCHAR(100),

    -- Pricing
    unit_price DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Lead time
    lead_time_days INTEGER,
    lead_time_text VARCHAR(100),     -- E.g., "5 Weeks"

    -- Preference
    is_preferred BOOLEAN DEFAULT false,

    -- Reference codes
    supplier_item_code VARCHAR(100),  -- Supplier's own item code
    photonics_ref VARCHAR(100),       -- Photonics reference number

    -- Validity
    valid_from DATE,
    valid_until DATE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One price per material-supplier combo
    CONSTRAINT unique_material_supplier UNIQUE (material_catalog_id, supplier_id)
);

-- ============================================
-- 3. Create budget_items table (Item-level budget tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS budget_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent relationships
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id) ON DELETE CASCADE,
    budget_category_id UUID NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,

    -- Source references (optional - allows manual budget items too)
    material_catalog_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
    boq_item_id UUID REFERENCES boq_items(id) ON DELETE SET NULL,

    -- Item identification
    item_code VARCHAR(50),
    description TEXT NOT NULL,
    category VARCHAR(100),           -- Denormalized for display
    uom VARCHAR(50),

    -- Budget quantities and amounts
    budgeted_quantity DECIMAL(15,4) NOT NULL DEFAULT 0,
    budgeted_rate DECIMAL(15,2) NOT NULL DEFAULT 0,
    budgeted_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        budgeted_quantity * budgeted_rate
    ) STORED,

    -- Tracking amounts (updated by triggers/APIs)
    committed_amount DECIMAL(15,2) DEFAULT 0,  -- From approved POs
    actual_amount DECIMAL(15,2) DEFAULT 0,     -- From completed GRNs

    -- Generated variance columns
    available_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        GREATEST(0, (budgeted_quantity * budgeted_rate) - committed_amount)
    ) STORED,
    variance_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        (budgeted_quantity * budgeted_rate) - actual_amount
    ) STORED,
    variance_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN (budgeted_quantity * budgeted_rate) > 0
            THEN ROUND((((budgeted_quantity * budgeted_rate) - actual_amount) / (budgeted_quantity * budgeted_rate) * 100)::numeric, 2)
            ELSE 0
        END
    ) STORED,

    -- Metadata
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    is_manual BOOLEAN DEFAULT false,  -- true if not from BOQ import

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_boq_item_per_budget UNIQUE (project_budget_id, boq_item_id)
);

-- ============================================
-- 4. Create material_match_history table (Audit trail for deduplication)
-- ============================================
CREATE TABLE IF NOT EXISTS material_match_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source BOQ
    boq_id UUID REFERENCES boqs(id) ON DELETE SET NULL,

    -- Input data that was matched
    input_item_code VARCHAR(50),
    input_description TEXT,
    input_category VARCHAR(100),

    -- Match result
    matched_material_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
    match_type VARCHAR(30) NOT NULL CHECK (match_type IN (
        'exact_code',           -- Item code exact match
        'fuzzy_description',    -- Description similarity >= 85%
        'new_item',             -- No match found, created new
        'duplicate_prevented',  -- Similar code prevented duplicate
        'manual_override'       -- User manually selected match
    )),
    match_confidence DECIMAL(5,4),  -- 0.0000 to 1.0000

    -- Details
    match_details JSONB,            -- Additional matching metadata

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. Alter boq_items table
-- ============================================
DO $$
BEGIN
    -- Add material_catalog_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boq_items' AND column_name = 'material_catalog_id'
    ) THEN
        ALTER TABLE boq_items ADD COLUMN material_catalog_id UUID
            REFERENCES material_catalog(id) ON DELETE SET NULL;
    END IF;

    -- Add item_code column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boq_items' AND column_name = 'item_code'
    ) THEN
        ALTER TABLE boq_items ADD COLUMN item_code VARCHAR(50);
    END IF;

    -- Add budget_category_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boq_items' AND column_name = 'budget_category_id'
    ) THEN
        ALTER TABLE boq_items ADD COLUMN budget_category_id UUID
            REFERENCES budget_categories(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================
-- 6. Alter purchase_order_items table
-- ============================================
DO $$
BEGIN
    -- Add budget_item_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order_items' AND column_name = 'budget_item_id'
    ) THEN
        ALTER TABLE purchase_order_items ADD COLUMN budget_item_id UUID
            REFERENCES budget_items(id) ON DELETE SET NULL;
    END IF;

    -- Add material_catalog_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order_items' AND column_name = 'material_catalog_id'
    ) THEN
        ALTER TABLE purchase_order_items ADD COLUMN material_catalog_id UUID
            REFERENCES material_catalog(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================
-- 7. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_material_catalog_item_code ON material_catalog(item_code);
CREATE INDEX IF NOT EXISTS idx_material_catalog_category ON material_catalog(category);
CREATE INDEX IF NOT EXISTS idx_material_catalog_budget_category ON material_catalog(budget_category);
CREATE INDEX IF NOT EXISTS idx_material_catalog_status ON material_catalog(status);

CREATE INDEX IF NOT EXISTS idx_material_suppliers_material ON material_suppliers(material_catalog_id);
CREATE INDEX IF NOT EXISTS idx_material_suppliers_supplier ON material_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_material_suppliers_preferred ON material_suppliers(is_preferred) WHERE is_preferred = true;

CREATE INDEX IF NOT EXISTS idx_budget_items_budget ON budget_items(project_budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_category ON budget_items(budget_category_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_material ON budget_items(material_catalog_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_boq_item ON budget_items(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_item_code ON budget_items(item_code);

CREATE INDEX IF NOT EXISTS idx_material_match_history_boq ON material_match_history(boq_id);
CREATE INDEX IF NOT EXISTS idx_material_match_history_material ON material_match_history(matched_material_id);
CREATE INDEX IF NOT EXISTS idx_material_match_history_type ON material_match_history(match_type);

CREATE INDEX IF NOT EXISTS idx_boq_items_material_catalog ON boq_items(material_catalog_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_item_code ON boq_items(item_code);
CREATE INDEX IF NOT EXISTS idx_boq_items_budget_category ON boq_items(budget_category_id);

CREATE INDEX IF NOT EXISTS idx_po_items_budget_item ON purchase_order_items(budget_item_id);
CREATE INDEX IF NOT EXISTS idx_po_items_material_catalog ON purchase_order_items(material_catalog_id);

-- ============================================
-- 8. Create updated_at trigger for new tables
-- ============================================
DROP TRIGGER IF EXISTS trg_material_catalog_updated ON material_catalog;
CREATE TRIGGER trg_material_catalog_updated
    BEFORE UPDATE ON material_catalog
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_updated_at();

DROP TRIGGER IF EXISTS trg_material_suppliers_updated ON material_suppliers;
CREATE TRIGGER trg_material_suppliers_updated
    BEFORE UPDATE ON material_suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_updated_at();

DROP TRIGGER IF EXISTS trg_budget_items_updated ON budget_items;
CREATE TRIGGER trg_budget_items_updated
    BEFORE UPDATE ON budget_items
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_updated_at();

-- ============================================
-- 9. Create function to update budget item on PO item
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_item_on_po_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_po RECORD;
BEGIN
    -- Get parent PO
    SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.purchase_order_id;

    -- Only process if PO is approved and budget item is linked
    IF NEW.budget_item_id IS NOT NULL AND v_po.status = 'approved' THEN
        UPDATE budget_items
        SET committed_amount = committed_amount + NEW.total_price,
            updated_at = NOW()
        WHERE id = NEW.budget_item_id;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================
-- 10. Create function to update budget item on GRN
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_item_on_grn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_po_item RECORD;
BEGIN
    -- Get PO item to find budget item
    SELECT * INTO v_po_item
    FROM purchase_order_items
    WHERE id = NEW.purchase_order_item_id;

    IF v_po_item.budget_item_id IS NOT NULL THEN
        UPDATE budget_items
        SET actual_amount = actual_amount + (NEW.received_quantity * v_po_item.unit_price),
            updated_at = NOW()
        WHERE id = v_po_item.budget_item_id;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================
-- 11. Comments
-- ============================================
COMMENT ON TABLE material_catalog IS 'Global material master catalog with Item Code as canonical identifier';
COMMENT ON TABLE material_suppliers IS 'Supplier-specific pricing for materials';
COMMENT ON TABLE budget_items IS 'Item-level budget tracking linked to BOQ items and material catalog';
COMMENT ON TABLE material_match_history IS 'Audit trail for BOQ item to material catalog matching';

COMMENT ON COLUMN material_catalog.item_code IS 'Canonical identifier (e.g., PRE066FT)';
COMMENT ON COLUMN material_catalog.normalized_description IS 'Lowercase, cleaned description for fuzzy matching';
COMMENT ON COLUMN material_catalog.keywords IS 'Extracted keywords for matching (e.g., {drop,cable,fiber,24,core})';

COMMENT ON COLUMN budget_items.budgeted_amount IS 'Generated: budgeted_quantity * budgeted_rate';
COMMENT ON COLUMN budget_items.variance_amount IS 'Generated: budgeted_amount - actual_amount';
COMMENT ON COLUMN budget_items.is_manual IS 'true if created manually, false if from BOQ import';

-- ============================================
-- Migration complete
-- ============================================
