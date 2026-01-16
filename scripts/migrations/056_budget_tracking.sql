-- Migration: 056_budget_tracking
-- PRD-057: Project Budget Tracking System
-- Created: 2026-01-16
-- Description: Add comprehensive budget tracking for projects

-- ============================================
-- 1. Create project_budgets table
-- ============================================
CREATE TABLE IF NOT EXISTS project_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Budget source
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'boq', 'hybrid')),
    boq_id UUID REFERENCES boqs(id),

    -- Budget amounts
    total_budget DECIMAL(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Tracked amounts (updated by triggers)
    committed_amount DECIMAL(15,2) DEFAULT 0,
    actual_amount DECIMAL(15,2) DEFAULT 0,

    -- Generated columns for calculations
    available_budget DECIMAL(15,2) GENERATED ALWAYS AS (
        GREATEST(0, total_budget - committed_amount)
    ) STORED,
    variance_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        total_budget - actual_amount
    ) STORED,
    variance_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN total_budget > 0
            THEN ROUND(((total_budget - actual_amount) / total_budget * 100)::numeric, 2)
            ELSE 0
        END
    ) STORED,

    -- Budget settings
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'locked', 'closed')),
    enforce_budget BOOLEAN DEFAULT true,
    allow_override BOOLEAN DEFAULT true,

    -- Alert thresholds
    alert_threshold_warning DECIMAL(5,2) DEFAULT 80,
    alert_threshold_critical DECIMAL(5,2) DEFAULT 100,

    -- Approval tracking
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,

    -- Audit fields
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One budget per project
    CONSTRAINT unique_project_budget UNIQUE (project_id)
);

-- ============================================
-- 2. Create budget_categories table
-- ============================================
CREATE TABLE IF NOT EXISTS budget_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id) ON DELETE CASCADE,

    -- Category identification
    category_code VARCHAR(50) NOT NULL,
    category_name VARCHAR(255) NOT NULL,

    -- Amounts
    allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    committed_amount DECIMAL(15,2) DEFAULT 0,
    actual_amount DECIMAL(15,2) DEFAULT 0,

    -- Generated column
    available_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        GREATEST(0, allocated_amount - committed_amount)
    ) STORED,

    -- Metadata
    is_custom BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique category per budget
    CONSTRAINT unique_category_per_budget UNIQUE (project_budget_id, category_code)
);

-- ============================================
-- 3. Create budget_transactions table (audit trail)
-- ============================================
CREATE TABLE IF NOT EXISTS budget_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id) ON DELETE CASCADE,
    category_id UUID REFERENCES budget_categories(id),

    -- Transaction type
    transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN (
        'allocation', 'adjustment', 'commitment', 'commitment_reversal', 'receipt', 'invoice', 'payment'
    )),

    -- Source reference (PO, GRN, etc)
    source_type VARCHAR(50),
    source_id UUID,
    source_number VARCHAR(100),

    -- Amounts
    amount DECIMAL(15,2) NOT NULL,
    tax_amount DECIMAL(15,2) DEFAULT 0,

    -- Running totals at time of transaction
    running_committed DECIMAL(15,2),
    running_actual DECIMAL(15,2),

    -- Description
    description TEXT,

    -- Audit
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 4. Create budget_alerts table
-- ============================================
CREATE TABLE IF NOT EXISTS budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id) ON DELETE CASCADE,

    -- Alert details
    alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN (
        'threshold_warning', 'threshold_critical', 'over_budget', 'po_blocked', 'override_approved'
    )),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

    -- Threshold info
    threshold_percent DECIMAL(5,2),
    current_percent DECIMAL(5,2),

    -- Message
    title VARCHAR(255) NOT NULL,
    message TEXT,

    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. Add columns to purchase_orders table
-- ============================================
DO $$
BEGIN
    -- Add budget_category_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_orders' AND column_name = 'budget_category_id'
    ) THEN
        ALTER TABLE purchase_orders ADD COLUMN budget_category_id UUID REFERENCES budget_categories(id);
    END IF;

    -- Add budget override fields
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_orders' AND column_name = 'budget_override_approved'
    ) THEN
        ALTER TABLE purchase_orders ADD COLUMN budget_override_approved BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_orders' AND column_name = 'budget_override_by'
    ) THEN
        ALTER TABLE purchase_orders ADD COLUMN budget_override_by VARCHAR(255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_orders' AND column_name = 'budget_override_reason'
    ) THEN
        ALTER TABLE purchase_orders ADD COLUMN budget_override_reason TEXT;
    END IF;
END $$;

-- ============================================
-- 6. Add budget columns to projects table
-- ============================================
DO $$
BEGIN
    -- Add budget_status
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'budget_status'
    ) THEN
        ALTER TABLE projects ADD COLUMN budget_status VARCHAR(30) DEFAULT 'not_set';
    END IF;

    -- Add budget_health
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'budget_health'
    ) THEN
        ALTER TABLE projects ADD COLUMN budget_health VARCHAR(20) DEFAULT 'healthy';
    END IF;

    -- Add budget_utilization
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'budget_utilization'
    ) THEN
        ALTER TABLE projects ADD COLUMN budget_utilization DECIMAL(5,2) DEFAULT 0;
    END IF;
END $$;

-- ============================================
-- 7. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_project_budgets_project_id ON project_budgets(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_categories_budget_id ON budget_categories(project_budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_budget_id ON budget_transactions(project_budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_source ON budget_transactions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_budget_id ON budget_alerts(project_budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_status ON budget_alerts(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_budget_category ON purchase_orders(budget_category_id);

-- ============================================
-- 8. Create function to check budget availability
-- ============================================
CREATE OR REPLACE FUNCTION check_budget_availability(
    p_project_id UUID,
    p_amount DECIMAL(15,2),
    p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_budget RECORD;
    v_category RECORD;
    v_utilization_before DECIMAL(5,2);
    v_utilization_after DECIMAL(5,2);
    v_available DECIMAL(15,2);
    v_shortfall DECIMAL(15,2);
    v_warning BOOLEAN;
BEGIN
    -- Get budget for project
    SELECT * INTO v_budget
    FROM project_budgets
    WHERE project_id = p_project_id
    AND status IN ('approved', 'locked');

    -- No budget configured
    IF v_budget IS NULL THEN
        RETURN jsonb_build_object(
            'allowed', true,
            'reason', 'no_budget',
            'available', 0,
            'requested', p_amount,
            'allow_override', false,
            'utilization_after', 0,
            'utilization_before', 0,
            'warning', false
        );
    END IF;

    -- Calculate utilization
    v_utilization_before := CASE WHEN v_budget.total_budget > 0
        THEN ROUND((v_budget.committed_amount / v_budget.total_budget * 100)::numeric, 2)
        ELSE 0 END;

    v_utilization_after := CASE WHEN v_budget.total_budget > 0
        THEN ROUND(((v_budget.committed_amount + p_amount) / v_budget.total_budget * 100)::numeric, 2)
        ELSE 0 END;

    v_available := v_budget.available_budget;
    v_warning := v_utilization_after > v_budget.alert_threshold_warning;

    -- Check category if provided
    IF p_category_id IS NOT NULL THEN
        SELECT * INTO v_category
        FROM budget_categories
        WHERE id = p_category_id;

        IF v_category IS NOT NULL AND p_amount > v_category.available_amount THEN
            v_shortfall := p_amount - v_category.available_amount;
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', 'category_over_budget',
                'available', v_category.available_amount,
                'requested', p_amount,
                'shortfall', v_shortfall,
                'allow_override', v_budget.allow_override,
                'utilization_after', v_utilization_after,
                'utilization_before', v_utilization_before,
                'warning', true
            );
        END IF;
    END IF;

    -- Check project budget
    IF p_amount > v_available AND v_budget.enforce_budget THEN
        v_shortfall := p_amount - v_available;
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'over_budget',
            'available', v_available,
            'requested', p_amount,
            'shortfall', v_shortfall,
            'allow_override', v_budget.allow_override,
            'utilization_after', v_utilization_after,
            'utilization_before', v_utilization_before,
            'warning', true
        );
    END IF;

    -- Within budget (or enforcement off)
    RETURN jsonb_build_object(
        'allowed', true,
        'reason', 'ok',
        'available', v_available,
        'requested', p_amount,
        'allow_override', v_budget.allow_override,
        'utilization_after', v_utilization_after,
        'utilization_before', v_utilization_before,
        'warning', v_warning
    );
END;
$$;

-- ============================================
-- 9. Create function to check and create alerts
-- ============================================
CREATE OR REPLACE FUNCTION check_budget_thresholds(p_budget_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_budget RECORD;
    v_utilization DECIMAL(5,2);
    v_has_warning BOOLEAN;
    v_has_critical BOOLEAN;
BEGIN
    -- Get budget
    SELECT * INTO v_budget FROM project_budgets WHERE id = p_budget_id;
    IF v_budget IS NULL THEN RETURN; END IF;

    -- Calculate utilization
    v_utilization := CASE WHEN v_budget.total_budget > 0
        THEN ROUND((v_budget.committed_amount / v_budget.total_budget * 100)::numeric, 2)
        ELSE 0 END;

    -- Check for existing active alerts
    SELECT EXISTS(
        SELECT 1 FROM budget_alerts
        WHERE project_budget_id = p_budget_id
        AND alert_type = 'threshold_warning'
        AND status = 'active'
    ) INTO v_has_warning;

    SELECT EXISTS(
        SELECT 1 FROM budget_alerts
        WHERE project_budget_id = p_budget_id
        AND alert_type = 'threshold_critical'
        AND status = 'active'
    ) INTO v_has_critical;

    -- Create critical alert if needed
    IF v_utilization >= v_budget.alert_threshold_critical AND NOT v_has_critical THEN
        INSERT INTO budget_alerts (
            project_budget_id, alert_type, severity,
            threshold_percent, current_percent,
            title, message
        ) VALUES (
            p_budget_id, 'threshold_critical', 'critical',
            v_budget.alert_threshold_critical, v_utilization,
            'Budget Critical: ' || v_utilization || '% utilized',
            'Project budget has reached ' || v_utilization || '% utilization. Immediate attention required.'
        );

        -- Update project health
        UPDATE projects
        SET budget_health = 'critical', budget_utilization = v_utilization
        WHERE id = v_budget.project_id;

    -- Create warning alert if needed
    ELSIF v_utilization >= v_budget.alert_threshold_warning AND NOT v_has_warning THEN
        INSERT INTO budget_alerts (
            project_budget_id, alert_type, severity,
            threshold_percent, current_percent,
            title, message
        ) VALUES (
            p_budget_id, 'threshold_warning', 'warning',
            v_budget.alert_threshold_warning, v_utilization,
            'Budget Warning: ' || v_utilization || '% utilized',
            'Project budget has reached ' || v_utilization || '% utilization. Monitor spending.'
        );

        -- Update project health
        UPDATE projects
        SET budget_health = 'warning', budget_utilization = v_utilization
        WHERE id = v_budget.project_id;

    -- Update utilization only if below thresholds
    ELSE
        UPDATE projects
        SET budget_utilization = v_utilization,
            budget_health = CASE
                WHEN v_utilization >= v_budget.alert_threshold_critical THEN 'critical'
                WHEN v_utilization >= v_budget.alert_threshold_warning THEN 'warning'
                ELSE 'healthy'
            END
        WHERE id = v_budget.project_id;
    END IF;
END;
$$;

-- ============================================
-- 10. Create trigger for PO approval
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_on_po_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_budget RECORD;
BEGIN
    -- Only process status changes
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    -- Get budget for this PO's project
    SELECT * INTO v_budget
    FROM project_budgets
    WHERE project_id = NEW.project_id;

    IF v_budget IS NULL THEN
        RETURN NEW;
    END IF;

    -- PO approved: add to committed
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        -- Update budget committed amount
        UPDATE project_budgets
        SET committed_amount = committed_amount + NEW.total_amount,
            updated_at = NOW()
        WHERE id = v_budget.id;

        -- Update category if set
        IF NEW.budget_category_id IS NOT NULL THEN
            UPDATE budget_categories
            SET committed_amount = committed_amount + NEW.total_amount,
                updated_at = NOW()
            WHERE id = NEW.budget_category_id;
        END IF;

        -- Create transaction record
        INSERT INTO budget_transactions (
            project_budget_id, category_id, transaction_type,
            source_type, source_id, source_number,
            amount, description, created_by
        ) VALUES (
            v_budget.id, NEW.budget_category_id, 'commitment',
            'purchase_order', NEW.id, NEW.po_number,
            NEW.total_amount, 'PO approved: ' || NEW.po_number, NEW.updated_by
        );

        -- Check thresholds
        PERFORM check_budget_thresholds(v_budget.id);

    -- PO cancelled: reverse commitment
    ELSIF NEW.status = 'cancelled' AND OLD.status = 'approved' THEN
        -- Update budget committed amount
        UPDATE project_budgets
        SET committed_amount = committed_amount - OLD.total_amount,
            updated_at = NOW()
        WHERE id = v_budget.id;

        -- Update category if set
        IF OLD.budget_category_id IS NOT NULL THEN
            UPDATE budget_categories
            SET committed_amount = committed_amount - OLD.total_amount,
                updated_at = NOW()
            WHERE id = OLD.budget_category_id;
        END IF;

        -- Create reversal transaction record
        INSERT INTO budget_transactions (
            project_budget_id, category_id, transaction_type,
            source_type, source_id, source_number,
            amount, description, created_by
        ) VALUES (
            v_budget.id, OLD.budget_category_id, 'commitment_reversal',
            'purchase_order', OLD.id, OLD.po_number,
            -OLD.total_amount, 'PO cancelled: ' || OLD.po_number, COALESCE(NEW.updated_by, 'system')
        );

        -- Check thresholds (might resolve alerts)
        PERFORM check_budget_thresholds(v_budget.id);
    END IF;

    RETURN NEW;
END;
$$;

-- Create trigger on purchase_orders
DROP TRIGGER IF EXISTS trg_budget_po_approval ON purchase_orders;
CREATE TRIGGER trg_budget_po_approval
    AFTER UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_on_po_approval();

-- ============================================
-- 11. Create trigger for GRN completion
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_on_grn_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_budget RECORD;
    v_po RECORD;
BEGIN
    -- Only process status changes to completed
    IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
        RETURN NEW;
    END IF;

    -- Get PO for this GRN
    SELECT * INTO v_po
    FROM purchase_orders
    WHERE id = NEW.purchase_order_id;

    IF v_po IS NULL THEN
        RETURN NEW;
    END IF;

    -- Get budget for project
    SELECT * INTO v_budget
    FROM project_budgets
    WHERE project_id = v_po.project_id;

    IF v_budget IS NULL THEN
        RETURN NEW;
    END IF;

    -- Update budget actual amount
    UPDATE project_budgets
    SET actual_amount = actual_amount + NEW.total_amount,
        updated_at = NOW()
    WHERE id = v_budget.id;

    -- Update category if PO had one
    IF v_po.budget_category_id IS NOT NULL THEN
        UPDATE budget_categories
        SET actual_amount = actual_amount + NEW.total_amount,
            updated_at = NOW()
        WHERE id = v_po.budget_category_id;
    END IF;

    -- Create transaction record
    INSERT INTO budget_transactions (
        project_budget_id, category_id, transaction_type,
        source_type, source_id, source_number,
        amount, description, created_by
    ) VALUES (
        v_budget.id, v_po.budget_category_id, 'receipt',
        'goods_receipt_note', NEW.id, NEW.grn_number,
        NEW.total_amount, 'GRN completed: ' || NEW.grn_number, COALESCE(NEW.received_by, 'system')
    );

    RETURN NEW;
END;
$$;

-- Create trigger on goods_receipt_notes
DROP TRIGGER IF EXISTS trg_budget_grn_completion ON goods_receipt_notes;
CREATE TRIGGER trg_budget_grn_completion
    AFTER UPDATE ON goods_receipt_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_on_grn_completion();

-- ============================================
-- 12. Seed default categories function
-- ============================================
CREATE OR REPLACE FUNCTION seed_default_budget_categories(p_budget_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO budget_categories (project_budget_id, category_code, category_name, sort_order, is_custom)
    VALUES
        (p_budget_id, 'MATERIALS', 'Materials & Consumables', 1, false),
        (p_budget_id, 'EQUIPMENT', 'Equipment & Tools', 2, false),
        (p_budget_id, 'LABOR', 'Labor Costs', 3, false),
        (p_budget_id, 'SUBCONTRACT', 'Subcontractor Work', 4, false),
        (p_budget_id, 'TRANSPORT', 'Transport & Logistics', 5, false),
        (p_budget_id, 'OVERHEAD', 'Overhead & Admin', 6, false),
        (p_budget_id, 'CONTINGENCY', 'Contingency Reserve', 7, false)
    ON CONFLICT (project_budget_id, category_code) DO NOTHING;
END;
$$;

-- ============================================
-- 13. Create updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_budget_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Apply to all budget tables
DROP TRIGGER IF EXISTS trg_project_budgets_updated ON project_budgets;
CREATE TRIGGER trg_project_budgets_updated
    BEFORE UPDATE ON project_budgets
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_updated_at();

DROP TRIGGER IF EXISTS trg_budget_categories_updated ON budget_categories;
CREATE TRIGGER trg_budget_categories_updated
    BEFORE UPDATE ON budget_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_updated_at();

-- ============================================
-- Migration complete
-- ============================================
COMMENT ON TABLE project_budgets IS 'PRD-057: Project budget master records';
COMMENT ON TABLE budget_categories IS 'PRD-057: Budget category breakdown';
COMMENT ON TABLE budget_transactions IS 'PRD-057: Budget transaction ledger (audit trail)';
COMMENT ON TABLE budget_alerts IS 'PRD-057: Budget threshold alerts';
