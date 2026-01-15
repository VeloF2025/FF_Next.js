-- Migration 051: Goods Receipt Notes
-- PRD-050: Comprehensive Procurement Portal - Phase 1
--
-- Purpose: Create goods receipt tables for receiving and validating
-- incoming deliveries against purchase orders.

-- ============================================================================
-- GOODS RECEIPT NOTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(50) UNIQUE NOT NULL,

    -- Source linkage
    purchase_order_id UUID REFERENCES purchase_orders(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),

    -- Delivery details
    delivery_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivery_note_number VARCHAR(100),
    carrier VARCHAR(100),
    vehicle_number VARCHAR(50),

    -- Location
    warehouse_id UUID NOT NULL REFERENCES stock_locations(id),
    receiving_bay VARCHAR(50),

    -- Status
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'receiving', 'inspecting', 'completed',
        'partial', 'rejected', 'cancelled'
    )),

    -- Inspection
    inspection_required BOOLEAN DEFAULT false,
    inspected_by VARCHAR(255),
    inspected_at TIMESTAMP WITH TIME ZONE,
    inspection_status VARCHAR(20) CHECK (inspection_status IN (
        'pending', 'passed', 'failed', 'partial'
    )),
    inspection_notes TEXT,

    -- Totals
    total_items INTEGER DEFAULT 0,
    total_quantity_expected DECIMAL(12,3) DEFAULT 0,
    total_quantity_received DECIMAL(12,3) DEFAULT 0,
    total_quantity_rejected DECIMAL(12,3) DEFAULT 0,

    -- Discrepancy handling
    has_discrepancy BOOLEAN DEFAULT false,
    discrepancy_notes TEXT,
    discrepancy_resolved BOOLEAN DEFAULT false,
    discrepancy_resolved_by VARCHAR(255),
    discrepancy_resolved_at TIMESTAMP WITH TIME ZONE,

    -- Personnel
    received_by VARCHAR(255) NOT NULL,
    received_by_name VARCHAR(255),
    verified_by VARCHAR(255),
    verified_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- GOODS RECEIPT ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id UUID NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES purchase_order_items(id),

    -- Item reference
    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT,

    -- Quantities
    quantity_expected DECIMAL(12,3),
    quantity_received DECIMAL(12,3) NOT NULL,
    quantity_rejected DECIMAL(12,3) DEFAULT 0,
    quantity_accepted DECIMAL(12,3) GENERATED ALWAYS AS (quantity_received - quantity_rejected) STORED,
    uom VARCHAR(20) NOT NULL,

    -- For serial-tracked items
    serial_numbers TEXT[], -- Array of serials received

    -- For lot-tracked items
    lot_number VARCHAR(100),
    batch_number VARCHAR(100),
    manufacture_date DATE,
    expiry_date DATE,

    -- Location assignment
    location_id UUID REFERENCES stock_locations(id),
    bin_location VARCHAR(50),

    -- Quality inspection
    inspection_status VARCHAR(30) CHECK (inspection_status IN (
        'pending', 'passed', 'failed', 'partial'
    )),
    rejection_reason TEXT,
    rejection_code VARCHAR(50),

    -- Valuation
    unit_cost DECIMAL(12,2),
    total_cost DECIMAL(14,2),

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_grn_status ON goods_receipt_notes(status);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipt_notes(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_grn_supplier ON goods_receipt_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_grn_warehouse ON goods_receipt_notes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_grn_delivery_date ON goods_receipt_notes(delivery_date);
CREATE INDEX IF NOT EXISTS idx_grn_discrepancy ON goods_receipt_notes(has_discrepancy) WHERE has_discrepancy = true;

CREATE INDEX IF NOT EXISTS idx_gri_grn ON goods_receipt_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_gri_po_item ON goods_receipt_items(po_item_id);
CREATE INDEX IF NOT EXISTS idx_gri_stock_item ON goods_receipt_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_gri_lot ON goods_receipt_items(lot_number);
CREATE INDEX IF NOT EXISTS idx_gri_inspection ON goods_receipt_items(inspection_status);

-- ============================================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_grn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_grn_updated_at ON goods_receipt_notes;
CREATE TRIGGER tr_grn_updated_at
    BEFORE UPDATE ON goods_receipt_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_grn_updated_at();

-- ============================================================================
-- FUNCTION: Generate GRN number
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_grn_number()
RETURNS TRIGGER AS $$
DECLARE
    year_suffix VARCHAR(2);
    next_num INTEGER;
BEGIN
    IF NEW.grn_number IS NULL OR NEW.grn_number = '' THEN
        year_suffix := TO_CHAR(NOW(), 'YY');

        SELECT COALESCE(MAX(
            CAST(SUBSTRING(grn_number FROM 6) AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM goods_receipt_notes
        WHERE grn_number LIKE 'GRN' || year_suffix || '%';

        NEW.grn_number := 'GRN' || year_suffix || '-' || LPAD(next_num::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_grn_number ON goods_receipt_notes;
CREATE TRIGGER tr_grn_number
    BEFORE INSERT ON goods_receipt_notes
    FOR EACH ROW
    EXECUTE FUNCTION generate_grn_number();

-- ============================================================================
-- FUNCTION: Update GRN totals
-- ============================================================================

CREATE OR REPLACE FUNCTION update_grn_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_grn_id UUID;
BEGIN
    v_grn_id := COALESCE(NEW.grn_id, OLD.grn_id);

    UPDATE goods_receipt_notes
    SET
        total_items = (SELECT COUNT(*) FROM goods_receipt_items WHERE grn_id = v_grn_id),
        total_quantity_expected = (SELECT COALESCE(SUM(quantity_expected), 0) FROM goods_receipt_items WHERE grn_id = v_grn_id),
        total_quantity_received = (SELECT COALESCE(SUM(quantity_received), 0) FROM goods_receipt_items WHERE grn_id = v_grn_id),
        total_quantity_rejected = (SELECT COALESCE(SUM(quantity_rejected), 0) FROM goods_receipt_items WHERE grn_id = v_grn_id),
        has_discrepancy = EXISTS (
            SELECT 1 FROM goods_receipt_items
            WHERE grn_id = v_grn_id
            AND (quantity_received <> quantity_expected OR quantity_rejected > 0)
        )
    WHERE id = v_grn_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_gri_totals ON goods_receipt_items;
CREATE TRIGGER tr_gri_totals
    AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION update_grn_totals();

-- ============================================================================
-- FUNCTION: Update PO item received quantities
-- ============================================================================

CREATE OR REPLACE FUNCTION update_poi_received()
RETURNS TRIGGER AS $$
BEGIN
    -- Update PO item received quantity
    IF NEW.po_item_id IS NOT NULL THEN
        UPDATE purchase_order_items
        SET
            quantity_received = (
                SELECT COALESCE(SUM(quantity_accepted), 0)
                FROM goods_receipt_items
                WHERE po_item_id = NEW.po_item_id
            ),
            status = CASE
                WHEN (SELECT COALESCE(SUM(quantity_accepted), 0) FROM goods_receipt_items WHERE po_item_id = NEW.po_item_id) >= quantity_ordered THEN 'received'
                WHEN (SELECT COALESCE(SUM(quantity_accepted), 0) FROM goods_receipt_items WHERE po_item_id = NEW.po_item_id) > 0 THEN 'partially_received'
                ELSE 'pending'
            END
        WHERE id = NEW.po_item_id;

        -- Update PO status based on items
        UPDATE purchase_orders
        SET status = (
            SELECT CASE
                WHEN COUNT(*) = COUNT(CASE WHEN status = 'received' THEN 1 END) THEN 'received'
                WHEN COUNT(CASE WHEN status IN ('received', 'partially_received') THEN 1 END) > 0 THEN 'partially_received'
                ELSE status
            END
            FROM purchase_order_items
            WHERE purchase_order_id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = NEW.po_item_id)
        )
        WHERE id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = NEW.po_item_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_gri_poi_update ON goods_receipt_items;
CREATE TRIGGER tr_gri_poi_update
    AFTER INSERT OR UPDATE ON goods_receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION update_poi_received();

-- ============================================================================
-- FUNCTION: Update stock_quants on receipt completion
-- ============================================================================

CREATE OR REPLACE FUNCTION process_grn_stock_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process when status changes to 'completed'
    IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
        -- Update stock quantities for each item
        INSERT INTO stock_quants (stock_item_id, location_id, quantity, lot_number, last_movement_date)
        SELECT
            gri.stock_item_id,
            COALESCE(gri.location_id, NEW.warehouse_id),
            gri.quantity_accepted,
            gri.lot_number,
            NOW()
        FROM goods_receipt_items gri
        WHERE gri.grn_id = NEW.id
        AND gri.stock_item_id IS NOT NULL
        ON CONFLICT (stock_item_id, location_id, lot_number)
        DO UPDATE SET
            quantity = stock_quants.quantity + EXCLUDED.quantity,
            last_movement_date = NOW();

        -- Create stock movement records
        INSERT INTO stock_movements (
            movement_type,
            reference_type,
            reference_id,
            stock_item_id,
            to_location_id,
            quantity,
            lot_number,
            created_by,
            created_at
        )
        SELECT
            'receipt',
            'grn',
            NEW.id,
            gri.stock_item_id,
            COALESCE(gri.location_id, NEW.warehouse_id),
            gri.quantity_accepted,
            gri.lot_number,
            NEW.received_by,
            NOW()
        FROM goods_receipt_items gri
        WHERE gri.grn_id = NEW.id
        AND gri.stock_item_id IS NOT NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_grn_stock_update ON goods_receipt_notes;
CREATE TRIGGER tr_grn_stock_update
    AFTER UPDATE ON goods_receipt_notes
    FOR EACH ROW
    EXECUTE FUNCTION process_grn_stock_update();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE goods_receipt_notes IS 'Goods receipt note headers - records of incoming deliveries';
COMMENT ON TABLE goods_receipt_items IS 'Line items for goods receipt notes';
COMMENT ON COLUMN goods_receipt_notes.status IS 'Workflow status: draft→receiving→inspecting→completed';
COMMENT ON COLUMN goods_receipt_notes.has_discrepancy IS 'Flag indicating quantity discrepancy between expected and received';
COMMENT ON COLUMN goods_receipt_items.serial_numbers IS 'Array of serial numbers for serial-tracked items';
COMMENT ON COLUMN goods_receipt_items.quantity_accepted IS 'Computed: quantity_received - quantity_rejected';
