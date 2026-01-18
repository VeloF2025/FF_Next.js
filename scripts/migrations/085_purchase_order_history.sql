-- Migration 085: Purchase Order History
-- Purpose: Create missing purchase_order_history table for tracking PO status changes
-- Required by: pages/api/procurement/purchase-orders/[id].ts

-- ============================================================================
-- PURCHASE ORDER HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_order_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

    -- Action tracking
    action VARCHAR(50) NOT NULL,
    notes TEXT,

    -- User tracking
    created_by VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_poh_po ON purchase_order_history(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_poh_action ON purchase_order_history(action);
CREATE INDEX IF NOT EXISTS idx_poh_created_at ON purchase_order_history(created_at);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE purchase_order_history IS 'Audit trail for purchase order status changes and actions';
COMMENT ON COLUMN purchase_order_history.action IS 'Action performed: submitted, approved, rejected, sent, acknowledged, completed, cancelled';
COMMENT ON COLUMN purchase_order_history.notes IS 'Optional notes explaining the action';
