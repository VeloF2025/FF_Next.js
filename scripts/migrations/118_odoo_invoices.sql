-- Migration 118: Odoo Invoice Sync Tables
-- Syncs vendor bills (account.move with move_type='in_invoice') from Odoo

-- Create invoices table for vendor bills
CREATE TABLE IF NOT EXISTS vendor_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Invoice identification
    invoice_number VARCHAR(100) NOT NULL,
    reference VARCHAR(255),

    -- Relationships
    supplier_id INTEGER REFERENCES suppliers(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),

    -- Dates
    invoice_date DATE,
    due_date DATE,
    accounting_date DATE,

    -- Amounts
    amount_untaxed NUMERIC(15,2) DEFAULT 0,
    amount_tax NUMERIC(15,2) DEFAULT 0,
    amount_total NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    amount_residual NUMERIC(15,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'ZAR',

    -- Status
    status VARCHAR(50) DEFAULT 'draft',
    payment_status VARCHAR(50) DEFAULT 'not_paid',

    -- Odoo sync fields
    odoo_move_id INTEGER UNIQUE,
    odoo_partner_id INTEGER,
    odoo_origin VARCHAR(255),
    odoo_synced_at TIMESTAMPTZ,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create invoice line items table
CREATE TABLE IF NOT EXISTS vendor_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    invoice_id UUID NOT NULL REFERENCES vendor_invoices(id) ON DELETE CASCADE,

    -- Product reference
    stock_item_id UUID REFERENCES stock_items(id),
    product_code VARCHAR(100),
    description TEXT,

    -- Quantities and amounts
    quantity NUMERIC(15,4) DEFAULT 1,
    unit_price NUMERIC(15,2) DEFAULT 0,
    discount_percent NUMERIC(5,2) DEFAULT 0,
    tax_amount NUMERIC(15,2) DEFAULT 0,
    subtotal NUMERIC(15,2) DEFAULT 0,

    -- Unit of measure
    uom VARCHAR(50),

    -- Odoo sync
    odoo_line_id INTEGER,
    odoo_product_id INTEGER,
    odoo_synced_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_supplier ON vendor_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_status ON vendor_invoices(status);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_payment_status ON vendor_invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_odoo_move ON vendor_invoices(odoo_move_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_date ON vendor_invoices(invoice_date);

CREATE INDEX IF NOT EXISTS idx_vendor_invoice_items_invoice ON vendor_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoice_items_stock ON vendor_invoice_items(stock_item_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_vendor_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_vendor_invoices_updated ON vendor_invoices;
CREATE TRIGGER tr_vendor_invoices_updated
    BEFORE UPDATE ON vendor_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_vendor_invoices_updated_at();

-- Comments
COMMENT ON TABLE vendor_invoices IS 'Vendor bills synced from Odoo account.move (in_invoice)';
COMMENT ON TABLE vendor_invoice_items IS 'Line items for vendor invoices';
