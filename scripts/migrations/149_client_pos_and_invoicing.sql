-- Migration: 149_client_pos_and_invoicing
-- Project Finance Dashboard: Client Purchase Orders and Customer Invoicing
-- Created: 2026-02-02
-- Description: Add client purchase orders (income/contract side) and customer invoicing system

-- ============================================
-- 1. Create client_purchase_orders table
-- ============================================
CREATE TABLE IF NOT EXISTS client_purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identification
    po_number VARCHAR(50) NOT NULL,
    reference VARCHAR(100),  -- Client's internal reference

    -- Relationships
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id),

    -- Contracted scope
    contracted_drops INTEGER NOT NULL,        -- Number of drops covered by this PO
    price_per_drop DECIMAL(12,2) NOT NULL,    -- Price per activation
    total_value DECIMAL(15,2) NOT NULL,       -- contracted_drops × price_per_drop

    -- Progress tracking (auto-updated by triggers)
    drops_assigned INTEGER DEFAULT 0,         -- Drops linked to this PO
    drops_activated INTEGER DEFAULT 0,        -- Drops activated (from OES)
    amount_invoiced DECIMAL(15,2) DEFAULT 0,  -- Total invoiced against this PO
    amount_paid DECIMAL(15,2) DEFAULT 0,      -- Total paid

    -- Status: draft|active|completed|cancelled
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),

    -- Dates
    po_date DATE NOT NULL,
    valid_from DATE,
    valid_to DATE,

    -- Tax
    tax_rate DECIMAL(5,2) DEFAULT 15.00,
    tax_inclusive BOOLEAN DEFAULT false,

    -- Notes
    description TEXT,
    terms TEXT,

    -- Audit
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique PO number per project
    CONSTRAINT unique_client_po_per_project UNIQUE (project_id, po_number)
);

-- ============================================
-- 2. Create customer_invoices table
-- ============================================
CREATE TABLE IF NOT EXISTS customer_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,

    -- Relationships
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id),
    client_po_id UUID REFERENCES client_purchase_orders(id),  -- Which PO this invoices against

    -- Billing period
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,

    -- Amounts
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 15.00,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(15,2) DEFAULT 0,

    -- Status: draft|pending_approval|approved|sent|paid|partially_paid|overdue|cancelled
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_approval', 'approved', 'sent',
        'paid', 'partially_paid', 'overdue', 'cancelled'
    )),

    -- Dates
    invoice_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    sent_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,

    -- Notes
    notes TEXT,
    internal_notes TEXT,

    -- Audit
    created_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. Create customer_invoice_items table
-- ============================================
CREATE TABLE IF NOT EXISTS customer_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,

    -- Link to drop/activation
    drop_id UUID REFERENCES drops(id),
    oes_activation_id UUID REFERENCES oes_activations(id),

    -- Denormalized for invoice permanence
    drop_number VARCHAR(50) NOT NULL,
    activation_date DATE,
    description TEXT,

    -- Pricing (from Client PO price_per_drop)
    unit_price DECIMAL(12,2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    line_total DECIMAL(14,2),

    -- Income type (extensible)
    income_type VARCHAR(50) DEFAULT 'activation' CHECK (income_type IN ('activation', 'bonus', 'adjustment', 'other')),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. Add columns to drops table
-- ============================================
DO $$
BEGIN
    -- Add client_po_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'client_po_id'
    ) THEN
        ALTER TABLE drops ADD COLUMN client_po_id UUID REFERENCES client_purchase_orders(id);
    END IF;

    -- Add invoiced flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'invoiced'
    ) THEN
        ALTER TABLE drops ADD COLUMN invoiced BOOLEAN DEFAULT false;
    END IF;

    -- Add invoice_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'invoice_id'
    ) THEN
        ALTER TABLE drops ADD COLUMN invoice_id UUID REFERENCES customer_invoices(id);
    END IF;
END $$;

-- ============================================
-- 5. Create invoice number sequence
-- ============================================
CREATE SEQUENCE IF NOT EXISTS customer_invoice_number_seq START WITH 1;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_customer_invoice_number()
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    v_year TEXT;
    v_seq INTEGER;
BEGIN
    v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
    v_seq := NEXTVAL('customer_invoice_number_seq');
    RETURN 'INV-' || v_year || '-' || LPAD(v_seq::TEXT, 5, '0');
END;
$$;

-- ============================================
-- 6. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_client_po_project ON client_purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_client_po_client ON client_purchase_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_client_po_status ON client_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_client_po_po_number ON client_purchase_orders(po_number);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_project ON customer_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_client ON customer_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_client_po ON customer_invoices(client_po_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_status ON customer_invoices(status);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_date ON customer_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_number ON customer_invoices(invoice_number);

CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_invoice ON customer_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_drop ON customer_invoice_items(drop_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_oes ON customer_invoice_items(oes_activation_id);

CREATE INDEX IF NOT EXISTS idx_drops_client_po ON drops(client_po_id);
CREATE INDEX IF NOT EXISTS idx_drops_invoiced ON drops(invoiced) WHERE invoiced = false;
CREATE INDEX IF NOT EXISTS idx_drops_invoice_id ON drops(invoice_id);

-- ============================================
-- 7. Trigger: Update client_po drops_assigned on drop assignment
-- ============================================
CREATE OR REPLACE FUNCTION update_client_po_drops_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Handle assignment (NULL -> UUID)
    IF OLD.client_po_id IS NULL AND NEW.client_po_id IS NOT NULL THEN
        UPDATE client_purchase_orders
        SET drops_assigned = drops_assigned + 1,
            updated_at = NOW()
        WHERE id = NEW.client_po_id;

    -- Handle unassignment (UUID -> NULL)
    ELSIF OLD.client_po_id IS NOT NULL AND NEW.client_po_id IS NULL THEN
        UPDATE client_purchase_orders
        SET drops_assigned = GREATEST(0, drops_assigned - 1),
            updated_at = NOW()
        WHERE id = OLD.client_po_id;

    -- Handle reassignment (UUID -> different UUID)
    ELSIF OLD.client_po_id IS NOT NULL AND NEW.client_po_id IS NOT NULL
          AND OLD.client_po_id != NEW.client_po_id THEN
        -- Decrement old
        UPDATE client_purchase_orders
        SET drops_assigned = GREATEST(0, drops_assigned - 1),
            updated_at = NOW()
        WHERE id = OLD.client_po_id;

        -- Increment new
        UPDATE client_purchase_orders
        SET drops_assigned = drops_assigned + 1,
            updated_at = NOW()
        WHERE id = NEW.client_po_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_drops_client_po_assigned ON drops;
CREATE TRIGGER trg_drops_client_po_assigned
    AFTER UPDATE OF client_po_id ON drops
    FOR EACH ROW
    EXECUTE FUNCTION update_client_po_drops_assigned();

-- ============================================
-- 8. Trigger: Update client_po drops_activated when OES confirms
-- ============================================
CREATE OR REPLACE FUNCTION update_client_po_drops_activated()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_client_po_id UUID;
BEGIN
    -- Find the drop's client_po_id
    SELECT client_po_id INTO v_client_po_id
    FROM drops
    WHERE id = NEW.drop_id;

    -- Only update if drop is assigned to a client PO
    IF v_client_po_id IS NOT NULL THEN
        -- New activation
        IF TG_OP = 'INSERT' THEN
            UPDATE client_purchase_orders
            SET drops_activated = drops_activated + 1,
                updated_at = NOW()
            WHERE id = v_client_po_id;

        -- Deleted activation (rare, but handle it)
        ELSIF TG_OP = 'DELETE' THEN
            UPDATE client_purchase_orders
            SET drops_activated = GREATEST(0, drops_activated - 1),
                updated_at = NOW()
            WHERE id = v_client_po_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oes_client_po_activated ON oes_activations;
CREATE TRIGGER trg_oes_client_po_activated
    AFTER INSERT OR DELETE ON oes_activations
    FOR EACH ROW
    EXECUTE FUNCTION update_client_po_drops_activated();

-- ============================================
-- 9. Trigger: Update client_po amount_invoiced when invoice created
-- ============================================
CREATE OR REPLACE FUNCTION update_client_po_amount_invoiced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Invoice approved/sent - add to amount_invoiced
    IF NEW.status IN ('approved', 'sent', 'paid', 'partially_paid')
       AND OLD.status = 'draft'
       AND NEW.client_po_id IS NOT NULL THEN
        UPDATE client_purchase_orders
        SET amount_invoiced = amount_invoiced + NEW.total_amount,
            updated_at = NOW()
        WHERE id = NEW.client_po_id;

    -- Invoice cancelled - reverse
    ELSIF NEW.status = 'cancelled'
          AND OLD.status IN ('approved', 'sent', 'paid', 'partially_paid')
          AND NEW.client_po_id IS NOT NULL THEN
        UPDATE client_purchase_orders
        SET amount_invoiced = GREATEST(0, amount_invoiced - OLD.total_amount),
            updated_at = NOW()
        WHERE id = NEW.client_po_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_invoice_amount ON customer_invoices;
CREATE TRIGGER trg_customer_invoice_amount
    AFTER UPDATE ON customer_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_client_po_amount_invoiced();

-- ============================================
-- 10. Trigger: Update client_po amount_paid when payment recorded
-- ============================================
CREATE OR REPLACE FUNCTION update_client_po_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_client_po_id UUID;
    v_payment_diff DECIMAL(15,2);
BEGIN
    -- Get client_po_id
    SELECT client_po_id INTO v_client_po_id
    FROM customer_invoices
    WHERE id = NEW.id;

    IF v_client_po_id IS NOT NULL THEN
        v_payment_diff := NEW.amount_paid - COALESCE(OLD.amount_paid, 0);

        IF v_payment_diff != 0 THEN
            UPDATE client_purchase_orders
            SET amount_paid = amount_paid + v_payment_diff,
                updated_at = NOW()
            WHERE id = v_client_po_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_invoice_payment ON customer_invoices;
CREATE TRIGGER trg_customer_invoice_payment
    AFTER UPDATE OF amount_paid ON customer_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_client_po_amount_paid();

-- ============================================
-- 11. Trigger: Update drops invoiced flag when invoice items created
-- ============================================
CREATE OR REPLACE FUNCTION update_drops_invoiced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.drop_id IS NOT NULL THEN
        UPDATE drops
        SET invoiced = true,
            invoice_id = (SELECT invoice_id FROM customer_invoice_items WHERE id = NEW.id)
        WHERE id = NEW.drop_id;

    ELSIF TG_OP = 'DELETE' AND OLD.drop_id IS NOT NULL THEN
        UPDATE drops
        SET invoiced = false,
            invoice_id = NULL
        WHERE id = OLD.drop_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_drops ON customer_invoice_items;
CREATE TRIGGER trg_invoice_items_drops
    AFTER INSERT OR DELETE ON customer_invoice_items
    FOR EACH ROW
    EXECUTE FUNCTION update_drops_invoiced();

-- ============================================
-- 12. Trigger: Auto-complete client PO when fully activated
-- ============================================
CREATE OR REPLACE FUNCTION check_client_po_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- If all contracted drops are activated and invoiced
    IF NEW.drops_activated >= NEW.contracted_drops
       AND NEW.amount_invoiced >= NEW.total_value
       AND NEW.status = 'active' THEN
        NEW.status := 'completed';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_po_completion ON client_purchase_orders;
CREATE TRIGGER trg_client_po_completion
    BEFORE UPDATE ON client_purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION check_client_po_completion();

-- ============================================
-- 13. Trigger: Updated_at for tables
-- ============================================
CREATE OR REPLACE FUNCTION update_finance_tables_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_po_updated ON client_purchase_orders;
CREATE TRIGGER trg_client_po_updated
    BEFORE UPDATE ON client_purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_finance_tables_updated_at();

DROP TRIGGER IF EXISTS trg_customer_invoices_updated ON customer_invoices;
CREATE TRIGGER trg_customer_invoices_updated
    BEFORE UPDATE ON customer_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_finance_tables_updated_at();

-- ============================================
-- 14. Function: Get uninvoiced activated drops for a project
-- ============================================
CREATE OR REPLACE FUNCTION get_uninvoiced_activated_drops(
    p_project_id UUID,
    p_client_po_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    drop_id UUID,
    drop_number VARCHAR,
    lid VARCHAR,
    client_po_id UUID,
    client_po_number VARCHAR,
    activation_date DATE,
    price_per_drop DECIMAL(12,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id AS drop_id,
        d.drop_number,
        d.lid,
        d.client_po_id,
        cpo.po_number AS client_po_number,
        oa.activation_date::DATE,
        COALESCE(cpo.price_per_drop, 0) AS price_per_drop
    FROM drops d
    INNER JOIN oes_activations oa ON oa.drop_id = d.id
    LEFT JOIN client_purchase_orders cpo ON cpo.id = d.client_po_id
    WHERE d.project_id = p_project_id
      AND d.invoiced = false
      AND (p_client_po_id IS NULL OR d.client_po_id = p_client_po_id)
      AND (p_start_date IS NULL OR oa.activation_date >= p_start_date)
      AND (p_end_date IS NULL OR oa.activation_date <= p_end_date)
    ORDER BY oa.activation_date DESC, d.drop_number;
END;
$$;

-- ============================================
-- 15. Function: Calculate invoice totals
-- ============================================
CREATE OR REPLACE FUNCTION calculate_invoice_totals(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_subtotal DECIMAL(15,2);
    v_tax_rate DECIMAL(5,2);
    v_tax_amount DECIMAL(15,2);
    v_total DECIMAL(15,2);
BEGIN
    -- Get tax rate from invoice
    SELECT tax_rate INTO v_tax_rate
    FROM customer_invoices
    WHERE id = p_invoice_id;

    -- Calculate subtotal from items
    SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal
    FROM customer_invoice_items
    WHERE invoice_id = p_invoice_id;

    -- Calculate tax
    v_tax_amount := ROUND(v_subtotal * v_tax_rate / 100, 2);
    v_total := v_subtotal + v_tax_amount;

    -- Update invoice
    UPDATE customer_invoices
    SET subtotal = v_subtotal,
        tax_amount = v_tax_amount,
        total_amount = v_total,
        updated_at = NOW()
    WHERE id = p_invoice_id;
END;
$$;

-- ============================================
-- 16. Function: Get project finance summary
-- ============================================
CREATE OR REPLACE FUNCTION get_project_finance_summary(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
    v_client_pos RECORD;
    v_budget RECORD;
    v_procurement RECORD;
BEGIN
    -- Client POs summary
    SELECT
        COALESCE(SUM(total_value), 0) AS total_contract_value,
        COALESCE(SUM(contracted_drops), 0) AS total_drops_contracted,
        COALESCE(SUM(drops_activated), 0) AS total_drops_activated,
        COALESCE(SUM(amount_invoiced), 0) AS total_invoiced,
        COALESCE(SUM(amount_paid), 0) AS total_paid,
        COUNT(*) AS po_count,
        COUNT(*) FILTER (WHERE status = 'active') AS active_po_count
    INTO v_client_pos
    FROM client_purchase_orders
    WHERE project_id = p_project_id
      AND status != 'cancelled';

    -- Budget summary
    SELECT
        total_budget,
        committed_amount,
        actual_amount,
        available_budget,
        CASE WHEN total_budget > 0
            THEN ROUND((committed_amount / total_budget * 100)::numeric, 2)
            ELSE 0
        END AS utilization_percent,
        CASE
            WHEN total_budget = 0 THEN 'healthy'
            WHEN committed_amount >= total_budget THEN 'critical'
            WHEN committed_amount >= total_budget * 0.8 THEN 'warning'
            ELSE 'healthy'
        END AS health
    INTO v_budget
    FROM project_budgets
    WHERE project_id = p_project_id;

    -- Procurement summary (supplier POs)
    SELECT
        COALESCE(SUM(total_amount), 0) AS total_po_value,
        COUNT(*) AS po_count,
        COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending_approval_count
    INTO v_procurement
    FROM purchase_orders
    WHERE project_id = p_project_id
      AND status != 'cancelled';

    -- Build result
    v_result := jsonb_build_object(
        'clientPOs', jsonb_build_object(
            'totalContractValue', v_client_pos.total_contract_value,
            'totalDropsContracted', v_client_pos.total_drops_contracted,
            'totalDropsActivated', v_client_pos.total_drops_activated,
            'totalInvoiced', v_client_pos.total_invoiced,
            'totalPaid', v_client_pos.total_paid,
            'totalOutstanding', v_client_pos.total_invoiced - v_client_pos.total_paid,
            'activationProgress', CASE WHEN v_client_pos.total_drops_contracted > 0
                THEN ROUND((v_client_pos.total_drops_activated::numeric / v_client_pos.total_drops_contracted * 100), 2)
                ELSE 0 END,
            'invoicingProgress', CASE WHEN v_client_pos.total_contract_value > 0
                THEN ROUND((v_client_pos.total_invoiced / v_client_pos.total_contract_value * 100), 2)
                ELSE 0 END,
            'poCount', v_client_pos.po_count,
            'activePoCount', v_client_pos.active_po_count
        ),
        'budget', CASE WHEN v_budget IS NOT NULL THEN jsonb_build_object(
            'totalBudget', v_budget.total_budget,
            'committedAmount', v_budget.committed_amount,
            'actualAmount', v_budget.actual_amount,
            'availableBudget', v_budget.available_budget,
            'utilizationPercent', v_budget.utilization_percent,
            'health', v_budget.health
        ) ELSE NULL END,
        'procurement', jsonb_build_object(
            'totalPOValue', v_procurement.total_po_value,
            'poCount', v_procurement.po_count,
            'pendingApprovalCount', v_procurement.pending_approval_count
        ),
        'netPosition', jsonb_build_object(
            'totalIncome', v_client_pos.total_invoiced,
            'totalExpenses', COALESCE(v_budget.actual_amount, 0),
            'margin', v_client_pos.total_invoiced - COALESCE(v_budget.actual_amount, 0)
        )
    );

    RETURN v_result;
END;
$$;

-- ============================================
-- Migration complete
-- ============================================
COMMENT ON TABLE client_purchase_orders IS 'Client Purchase Orders - income/contract side for customer invoicing';
COMMENT ON TABLE customer_invoices IS 'Customer invoices generated from OES activations against Client POs';
COMMENT ON TABLE customer_invoice_items IS 'Line items for customer invoices (activated drops)';
COMMENT ON COLUMN drops.client_po_id IS 'Link to Client PO covering this drop';
COMMENT ON COLUMN drops.invoiced IS 'Whether this drop has been included in a customer invoice';
COMMENT ON COLUMN drops.invoice_id IS 'Reference to the customer invoice containing this drop';
