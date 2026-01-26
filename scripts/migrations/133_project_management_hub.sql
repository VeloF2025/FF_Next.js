-- Migration 133: Project Management Hub (PRD-058)
-- Creates tables for project workflow, contractor agreements, and document expiry tracking

-- ============================================================================
-- 1. PROJECT REQUIREMENTS TABLE (Workflow checklists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Requirement identification
    requirement_type VARCHAR(50) NOT NULL,
    -- Pipeline: 'wayleave', 'permit', 'client_agreement', 'feasibility', 'documentation'
    -- Planning: 'boq_approved', 'contractor_appointed', 'budget_approved', 'hs_verified', 'team_assigned'
    -- Execution: 'drops_complete', 'qa_passed'
    -- Closure: 'final_inspection', 'client_handover'

    requirement_name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Completion tracking
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by VARCHAR(255),

    -- Document reference (for requirements with attached documents)
    document_id UUID,
    document_url TEXT,

    -- Expiry tracking (for wayleaves, permits)
    expiry_date DATE,
    expiry_alert_sent BOOLEAN DEFAULT false,

    -- Workflow stage this requirement belongs to
    stage VARCHAR(30) NOT NULL CHECK (stage IN ('pipeline', 'planning', 'execution', 'closure')),
    sort_order INTEGER DEFAULT 0,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for project_requirements
CREATE INDEX IF NOT EXISTS idx_project_requirements_project ON project_requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_project_requirements_stage ON project_requirements(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_project_requirements_expiry ON project_requirements(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_requirements_incomplete ON project_requirements(project_id, stage) WHERE is_completed = false;

-- ============================================================================
-- 2. CONTRACTOR AGREEMENTS TABLE (SOW + MBA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS contractor_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    contractor_id UUID NOT NULL REFERENCES contractors(id),

    -- Agreement type
    agreement_type VARCHAR(30) NOT NULL CHECK (agreement_type IN ('sow', 'mba')),

    -- SOW-specific fields
    work_scope TEXT,
    rate_card JSONB DEFAULT '[]'::jsonb,
    -- Format: [{"item": "Fiber installation per meter", "unit": "m", "rate": 45.00}, ...]
    rights_granted TEXT,
    terms_reference TEXT,

    -- MBA-specific: reference to SOW
    sow_agreement_id UUID REFERENCES contractor_agreements(id),

    -- Status tracking
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_review', 'sent', 'signed', 'active', 'expired', 'terminated'
    )),

    -- Document references
    draft_document_url TEXT,
    signed_document_url TEXT,

    -- Dates
    effective_date DATE,
    expiry_date DATE,
    sent_at TIMESTAMP WITH TIME ZONE,
    signed_at TIMESTAMP WITH TIME ZONE,

    -- Signatures
    contractor_signatory VARCHAR(255),
    company_signatory VARCHAR(255),

    -- Audit
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for contractor_agreements
CREATE INDEX IF NOT EXISTS idx_contractor_agreements_project ON contractor_agreements(project_id);
CREATE INDEX IF NOT EXISTS idx_contractor_agreements_contractor ON contractor_agreements(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_agreements_type ON contractor_agreements(project_id, agreement_type);
CREATE INDEX IF NOT EXISTS idx_contractor_agreements_status ON contractor_agreements(status) WHERE status IN ('draft', 'sent', 'active');
CREATE INDEX IF NOT EXISTS idx_contractor_agreements_expiry ON contractor_agreements(expiry_date) WHERE expiry_date IS NOT NULL;

-- ============================================================================
-- 3. DOCUMENT EXPIRY TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_expiry_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Polymorphic reference to the owning entity
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('project', 'contractor', 'staff')),
    entity_id UUID NOT NULL,

    -- Project association (for project-scoped queries)
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

    -- Document identification
    document_type VARCHAR(50) NOT NULL,
    -- 'tax_clearance', 'comp_commissioner', 'wayleave', 'permit',
    -- 'insurance', 'safety_training', 'trade_certificate'
    document_name VARCHAR(255) NOT NULL,
    document_url TEXT,

    -- Validity dates
    issue_date DATE,
    expiry_date DATE NOT NULL,

    -- Alert tracking
    alert_90_sent BOOLEAN DEFAULT false,
    alert_60_sent BOOLEAN DEFAULT false,
    alert_30_sent BOOLEAN DEFAULT false,
    alert_expired_sent BOOLEAN DEFAULT false,

    -- Status
    status VARCHAR(30) DEFAULT 'valid' CHECK (status IN (
        'valid', 'expiring_soon', 'expired', 'renewed'
    )),

    -- Renewal tracking
    renewed_document_id UUID REFERENCES document_expiry_tracking(id),

    -- Notes
    notes TEXT,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for document_expiry_tracking
CREATE INDEX IF NOT EXISTS idx_doc_expiry_project ON document_expiry_tracking(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_expiry_entity ON document_expiry_tracking(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_doc_expiry_date ON document_expiry_tracking(expiry_date);
CREATE INDEX IF NOT EXISTS idx_doc_expiry_status ON document_expiry_tracking(status) WHERE status IN ('valid', 'expiring_soon');
CREATE INDEX IF NOT EXISTS idx_doc_expiry_alerts ON document_expiry_tracking(expiry_date, alert_30_sent)
    WHERE status = 'valid' AND alert_30_sent = false;

-- ============================================================================
-- 4. ADD COLUMNS TO PROJECTS TABLE
-- ============================================================================

-- Pipeline sub-stage for kanban
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'projects' AND column_name = 'pipeline_sub_stage') THEN
        ALTER TABLE projects ADD COLUMN pipeline_sub_stage VARCHAR(30)
            CHECK (pipeline_sub_stage IN ('prospect', 'qualifying', 'ready'));
    END IF;
END $$;

-- Workflow tracking columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'projects' AND column_name = 'requirements_met') THEN
        ALTER TABLE projects ADD COLUMN requirements_met INTEGER DEFAULT 0;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'projects' AND column_name = 'requirements_total') THEN
        ALTER TABLE projects ADD COLUMN requirements_total INTEGER DEFAULT 0;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'projects' AND column_name = 'expiring_docs_count') THEN
        ALTER TABLE projects ADD COLUMN expiring_docs_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- ============================================================================
-- 5. ADD COLUMNS TO CONTRACTORS TABLE
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'contractors' AND column_name = 'tax_clearance_expiry') THEN
        ALTER TABLE contractors ADD COLUMN tax_clearance_expiry DATE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'contractors' AND column_name = 'comp_commissioner_expiry') THEN
        ALTER TABLE contractors ADD COLUMN comp_commissioner_expiry DATE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'contractors' AND column_name = 'insurance_expiry') THEN
        ALTER TABLE contractors ADD COLUMN insurance_expiry DATE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'contractors' AND column_name = 'has_expiring_docs') THEN
        ALTER TABLE contractors ADD COLUMN has_expiring_docs BOOLEAN DEFAULT false;
    END IF;
END $$;

-- ============================================================================
-- 6. UPDATE TRIGGERS
-- ============================================================================

-- Trigger to update project requirements count
CREATE OR REPLACE FUNCTION update_project_requirements_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE projects SET
            requirements_met = (
                SELECT COUNT(*) FROM project_requirements
                WHERE project_id = NEW.project_id AND is_completed = true
            ),
            requirements_total = (
                SELECT COUNT(*) FROM project_requirements
                WHERE project_id = NEW.project_id
            ),
            updated_at = NOW()
        WHERE id = NEW.project_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE projects SET
            requirements_met = (
                SELECT COUNT(*) FROM project_requirements
                WHERE project_id = OLD.project_id AND is_completed = true
            ),
            requirements_total = (
                SELECT COUNT(*) FROM project_requirements
                WHERE project_id = OLD.project_id
            ),
            updated_at = NOW()
        WHERE id = OLD.project_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_project_requirements_count ON project_requirements;
CREATE TRIGGER trigger_update_project_requirements_count
    AFTER INSERT OR UPDATE OR DELETE ON project_requirements
    FOR EACH ROW
    EXECUTE FUNCTION update_project_requirements_count();

-- Trigger to update document expiry status
CREATE OR REPLACE FUNCTION update_document_expiry_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expiry_date IS NOT NULL THEN
        IF NEW.expiry_date < CURRENT_DATE THEN
            NEW.status = 'expired';
        ELSIF NEW.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN
            NEW.status = 'expiring_soon';
        ELSE
            NEW.status = 'valid';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_document_expiry_status ON document_expiry_tracking;
CREATE TRIGGER trigger_update_document_expiry_status
    BEFORE INSERT OR UPDATE ON document_expiry_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_document_expiry_status();

-- ============================================================================
-- 7. SEED DEFAULT REQUIREMENTS TEMPLATE
-- ============================================================================

-- Create a function to seed default requirements for a project
CREATE OR REPLACE FUNCTION seed_project_requirements(p_project_id UUID)
RETURNS void AS $$
BEGIN
    -- Pipeline requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'wayleave', 'Municipal Wayleaves', 'Obtain municipal wayleave approvals', 'pipeline', 1),
        (p_project_id, 'permit', 'Required Permits', 'Secure all necessary permits', 'pipeline', 2),
        (p_project_id, 'client_agreement', 'Client Agreement', 'Client contract signed', 'pipeline', 3),
        (p_project_id, 'feasibility', 'Feasibility Study', 'Technical feasibility confirmed', 'pipeline', 4),
        (p_project_id, 'documentation', 'Initial Documentation', 'Gather initial project documents', 'pipeline', 5)
    ON CONFLICT DO NOTHING;

    -- Planning requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'boq_approved', 'BOQ Approved', 'Bill of Quantities uploaded and approved', 'planning', 1),
        (p_project_id, 'contractor_appointed', 'Contractor Appointed', 'Contractor assigned with valid documents', 'planning', 2),
        (p_project_id, 'sow_signed', 'SOW Signed', 'Scope of Work signed by contractor', 'planning', 3),
        (p_project_id, 'mba_signed', 'MBA Signed', 'Master Build Agreement signed', 'planning', 4),
        (p_project_id, 'budget_approved', 'Budget Approved', 'Project budget allocated and approved', 'planning', 5),
        (p_project_id, 'hs_verified', 'H&S Verified', 'Health & Safety compliance verified', 'planning', 6),
        (p_project_id, 'team_assigned', 'Team Assigned', 'Project team assigned', 'planning', 7)
    ON CONFLICT DO NOTHING;

    -- Execution requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'drops_complete', 'All Drops Installed', '100% drop completion', 'execution', 1),
        (p_project_id, 'qa_passed', 'QA Validation Passed', 'All installations validated', 'execution', 2)
    ON CONFLICT DO NOTHING;

    -- Closure requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'final_inspection', 'Final Inspection', 'Site inspection completed', 'closure', 1),
        (p_project_id, 'client_handover', 'Client Handover', 'Handover document signed', 'closure', 2)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. VIEWS FOR REPORTING
-- ============================================================================

-- View for portfolio dashboard metrics
CREATE OR REPLACE VIEW v_portfolio_metrics AS
SELECT
    COUNT(*) FILTER (WHERE status IS NOT NULL) as total_projects,
    COUNT(*) FILTER (WHERE status = 'pipeline') as pipeline_count,
    COUNT(*) FILTER (WHERE status = 'planning' OR status = 'planned') as planned_count,
    COUNT(*) FILTER (WHERE status = 'active' OR status = 'in_progress') as active_count,
    COUNT(*) FILTER (WHERE status = 'completed' OR status = 'complete') as completed_count,
    COUNT(*) FILTER (WHERE status = 'on_hold') as on_hold_count,
    COALESCE(SUM(budget), 0) as total_budget,
    COALESCE(SUM(actual_cost), 0) as total_actual,
    COUNT(*) FILTER (WHERE expiring_docs_count > 0) as projects_with_expiring_docs
FROM projects
WHERE deleted_at IS NULL OR deleted_at IS NULL;

-- View for expiring documents by project
CREATE OR REPLACE VIEW v_project_expiring_docs AS
SELECT
    det.project_id,
    p.project_name,
    det.entity_type,
    det.entity_id,
    det.document_type,
    det.document_name,
    det.expiry_date,
    det.status,
    CASE
        WHEN det.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN det.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN '30_days'
        WHEN det.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN '60_days'
        WHEN det.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN '90_days'
        ELSE 'valid'
    END as urgency
FROM document_expiry_tracking det
LEFT JOIN projects p ON det.project_id = p.id
WHERE det.status != 'renewed'
ORDER BY det.expiry_date ASC;

-- ============================================================================
-- 9. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE project_requirements IS 'Workflow checklist items for project lifecycle stages (PRD-058)';
COMMENT ON TABLE contractor_agreements IS 'Scope of Work (SOW) and Master Build Agreements (MBA) for contractors (PRD-058)';
COMMENT ON TABLE document_expiry_tracking IS 'Unified document expiry tracking across projects, contractors, and staff (PRD-058)';
COMMENT ON FUNCTION seed_project_requirements IS 'Seeds default workflow requirements for a new project';
COMMENT ON VIEW v_portfolio_metrics IS 'Aggregated portfolio metrics for dashboard';
COMMENT ON VIEW v_project_expiring_docs IS 'Documents nearing or past expiry grouped by project';
