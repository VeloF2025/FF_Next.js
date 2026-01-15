-- Migration 050: Purchase Orders
-- PRD-050: Comprehensive Procurement Portal - Phase 1
--
-- Purpose: Create purchase order tables for formalizing purchases with suppliers
-- after quote acceptance.

-- ============================================================================
-- PURCHASE ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) UNIQUE NOT NULL,

    -- Source linkage
    requisition_id UUID REFERENCES purchase_requisitions(id),
    rfq_id UUID REFERENCES rfqs(id),
    quote_id UUID REFERENCES quotes(id),

    -- Supplier
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    supplier_contact VARCHAR(255),

    -- Context
    project_id UUID REFERENCES projects(id),
    warehouse_id UUID REFERENCES stock_locations(id),

    -- Dates
    order_date DATE DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    actual_delivery_date DATE,

    -- Status
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'approved', 'sent',
        'acknowledged', 'partially_received', 'received',
        'invoiced', 'paid', 'cancelled', 'closed'
    )),

    -- Approval
    approval_required BOOLEAN DEFAULT false,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,

    -- Financials
    subtotal DECIMAL(14,2),
    tax_rate DECIMAL(5,2) DEFAULT 15.00,
    tax_amount DECIMAL(14,2),
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(14,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Amount tracking
    amount_received DECIMAL(14,2) DEFAULT 0,
    amount_invoiced DECIMAL(14,2) DEFAULT 0,
    amount_paid DECIMAL(14,2) DEFAULT 0,

    -- Terms
    payment_terms VARCHAR(100),
    delivery_address TEXT,
    shipping_method VARCHAR(100),
    incoterms VARCHAR(20),

    -- Tracking
    supplier_reference VARCHAR(100),
    internal_notes TEXT,
    supplier_notes TEXT,

    -- Sent tracking
    sent_at TIMESTAMP WITH TIME ZONE,
    sent_via VARCHAR(20), -- email, portal, manual
    acknowledged_at TIMESTAMP WITH TIME ZONE,

    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- PURCHASE ORDER ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

    -- Item reference
    stock_item_id UUID REFERENCES stock_items(id),
    boq_item_id UUID REFERENCES boq_items(id),
    requisition_item_id UUID REFERENCES purchase_requisition_items(id),

    -- Item details
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,

    -- Quantities
    quantity_ordered DECIMAL(12,3) NOT NULL,
    quantity_received DECIMAL(12,3) DEFAULT 0,
    quantity_invoiced DECIMAL(12,3) DEFAULT 0,
    uom VARCHAR(20) NOT NULL,

    -- Pricing
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_rate DECIMAL(5,2),
    tax_amount DECIMAL(12,2),
    total_price DECIMAL(14,2),

    -- Tracking
    expected_delivery_date DATE,
    actual_delivery_date DATE,

    -- Status
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
        'pending', 'partially_received', 'received', 'cancelled'
    )),

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_po_order_date ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_po_requisition ON purchase_orders(requisition_id);
CREATE INDEX IF NOT EXISTS idx_po_rfq ON purchase_orders(rfq_id);
CREATE INDEX IF NOT EXISTS idx_po_quote ON purchase_orders(quote_id);

CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_poi_stock_item ON purchase_order_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_poi_boq_item ON purchase_order_items(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_poi_status ON purchase_order_items(status);

-- ============================================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_po_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_po_updated_at ON purchase_orders;
CREATE TRIGGER tr_po_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_po_updated_at();

-- ============================================================================
-- FUNCTION: Generate PO number
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
DECLARE
    year_suffix VARCHAR(2);
    next_num INTEGER;
BEGIN
    IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
        year_suffix := TO_CHAR(NOW(), 'YY');

        SELECT COALESCE(MAX(
            CAST(SUBSTRING(po_number FROM 5) AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM purchase_orders
        WHERE po_number LIKE 'PO' || year_suffix || '%';

        NEW.po_number := 'PO' || year_suffix || '-' || LPAD(next_num::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_po_number ON purchase_orders;
CREATE TRIGGER tr_po_number
    BEFORE INSERT ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION generate_po_number();

-- ============================================================================
-- FUNCTION: Calculate PO totals
-- ============================================================================

CREATE OR REPLACE FUNCTION update_po_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_subtotal DECIMAL(14,2);
    v_tax DECIMAL(14,2);
    v_po_id UUID;
BEGIN
    v_po_id := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);

    SELECT
        COALESCE(SUM(total_price), 0),
        COALESCE(SUM(tax_amount), 0)
    INTO v_subtotal, v_tax
    FROM purchase_order_items
    WHERE purchase_order_id = v_po_id;

    UPDATE purchase_orders
    SET
        subtotal = v_subtotal,
        tax_amount = v_tax,
        total_amount = v_subtotal + v_tax + COALESCE(shipping_cost, 0) - COALESCE(discount_amount, 0)
    WHERE id = v_po_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_poi_totals ON purchase_order_items;
CREATE TRIGGER tr_poi_totals
    AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_po_totals();

-- ============================================================================
-- FUNCTION: Calculate line item total
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_poi_total()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate total price
    NEW.total_price := NEW.quantity_ordered * NEW.unit_price * (1 - COALESCE(NEW.discount_percent, 0) / 100);

    -- Calculate tax if rate provided
    IF NEW.tax_rate IS NOT NULL THEN
        NEW.tax_amount := NEW.total_price * NEW.tax_rate / 100;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_poi_calc ON purchase_order_items;
CREATE TRIGGER tr_poi_calc
    BEFORE INSERT OR UPDATE ON purchase_order_items
    FOR EACH ROW
    EXECUTE FUNCTION calculate_poi_total();

-- ============================================================================
-- FUNCTION: Update requisition item status
-- ============================================================================

CREATE OR REPLACE FUNCTION update_pri_converted()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.requisition_item_id IS NOT NULL THEN
        UPDATE purchase_requisition_items
        SET
            converted_to_po = true,
            po_id = NEW.purchase_order_id
        WHERE id = NEW.requisition_item_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_poi_pri_update ON purchase_order_items;
CREATE TRIGGER tr_poi_pri_update
    AFTER INSERT ON purchase_order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_pri_converted();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE purchase_orders IS 'Purchase order headers - formal orders to suppliers';
COMMENT ON TABLE purchase_order_items IS 'Line items for purchase orders';
COMMENT ON COLUMN purchase_orders.status IS 'Workflow status: draft→pending_approval→approved→sent→acknowledged→received→invoiced→paid';
COMMENT ON COLUMN purchase_orders.amount_received IS 'Running total of received amount for 3-way matching';
COMMENT ON COLUMN purchase_order_items.quantity_received IS 'Running total of received quantity from GRNs';
