-- Migration: 150_client_po_activation_requirement
-- Project Activation Requirements Enhancement
-- Created: 2026-02-02
-- Description: Add client_po to planning requirements and create activation validation functions

-- ============================================
-- 1. Update seed_project_requirements to include client_po
-- ============================================

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

    -- Planning requirements (now includes client_po)
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'client_po', 'Client PO Active', 'At least one active Client Purchase Order', 'planning', 1),
        (p_project_id, 'boq_approved', 'BOQ Approved', 'Bill of Quantities uploaded and approved', 'planning', 2),
        (p_project_id, 'contractor_appointed', 'Contractor Appointed', 'Contractor assigned with valid documents', 'planning', 3),
        (p_project_id, 'sow_signed', 'SOW Signed', 'Scope of Work signed by contractor', 'planning', 4),
        (p_project_id, 'mba_signed', 'MBA Signed', 'Master Build Agreement signed', 'planning', 5),
        (p_project_id, 'budget_approved', 'Budget Approved', 'Project budget allocated and approved', 'planning', 6),
        (p_project_id, 'hs_verified', 'H&S Verified', 'Health & Safety compliance verified', 'planning', 7),
        (p_project_id, 'team_assigned', 'Team Assigned', 'Project team assigned', 'planning', 8)
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

-- ============================================
-- 2. Add client_po requirement to existing projects that don't have it
-- ============================================

INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
SELECT
    p.id,
    'client_po',
    'Client PO Active',
    'At least one active Client Purchase Order',
    'planning',
    0  -- Sort before other planning requirements
FROM projects p
WHERE NOT EXISTS (
    SELECT 1 FROM project_requirements pr
    WHERE pr.project_id = p.id
    AND pr.requirement_type = 'client_po'
);

-- ============================================
-- 3. Function: Check if project has active client PO
-- ============================================

CREATE OR REPLACE FUNCTION check_project_has_active_client_po(p_project_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_active_po BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM client_purchase_orders
        WHERE project_id = p_project_id
        AND status = 'active'
    ) INTO v_has_active_po;

    RETURN v_has_active_po;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. Function: Check wayleave approvals valid (not expired)
-- ============================================

CREATE OR REPLACE FUNCTION check_project_wayleaves_valid(p_project_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_expired TEXT[];
    v_valid BOOLEAN := true;
    v_pipeline_project_id UUID;
BEGIN
    -- Find the linked pipeline project
    SELECT id INTO v_pipeline_project_id
    FROM pipeline_projects
    WHERE planned_project_id = p_project_id;

    IF v_pipeline_project_id IS NULL THEN
        -- Check if project itself has wayleave requirements
        SELECT ARRAY_AGG(requirement_name)
        INTO v_expired
        FROM project_requirements
        WHERE project_id = p_project_id
        AND requirement_type = 'wayleave'
        AND expiry_date IS NOT NULL
        AND expiry_date < CURRENT_DATE;

        IF v_expired IS NOT NULL AND array_length(v_expired, 1) > 0 THEN
            v_valid := false;
        END IF;

        RETURN jsonb_build_object(
            'valid', v_valid,
            'expired', COALESCE(v_expired, ARRAY[]::TEXT[]),
            'checked', 'project_requirements'
        );
    END IF;

    -- Check pipeline project approvals
    SELECT ARRAY_AGG(pat.name)
    INTO v_expired
    FROM pipeline_project_approvals ppa
    JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
    WHERE ppa.pipeline_project_id = v_pipeline_project_id
    AND pat.category = 'wayleave'
    AND ppa.expiry_date IS NOT NULL
    AND ppa.expiry_date < CURRENT_DATE;

    IF v_expired IS NOT NULL AND array_length(v_expired, 1) > 0 THEN
        v_valid := false;
    END IF;

    RETURN jsonb_build_object(
        'valid', v_valid,
        'expired', COALESCE(v_expired, ARRAY[]::TEXT[]),
        'checked', 'pipeline_approvals'
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Function: Check H&S compliance verified
-- ============================================

CREATE OR REPLACE FUNCTION check_project_hs_verified(p_project_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_verified BOOLEAN;
BEGIN
    -- Check project_requirements for hs_verified
    SELECT is_completed INTO v_verified
    FROM project_requirements
    WHERE project_id = p_project_id
    AND requirement_type = 'hs_verified'
    AND stage = 'planning'
    LIMIT 1;

    RETURN COALESCE(v_verified, false);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Function: Check contractor has signed SOW/MBA
-- ============================================

CREATE OR REPLACE FUNCTION check_project_contractor_signed(p_project_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_has_signed BOOLEAN := false;
    v_signed_agreements TEXT[];
BEGIN
    -- Check contractor_agreements table
    SELECT
        COUNT(*) > 0,
        ARRAY_AGG(DISTINCT agreement_type)
    INTO v_has_signed, v_signed_agreements
    FROM contractor_agreements
    WHERE project_id = p_project_id
    AND status IN ('signed', 'active');

    RETURN jsonb_build_object(
        'hasSigned', v_has_signed,
        'signedAgreements', COALESCE(v_signed_agreements, ARRAY[]::TEXT[])
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. Function: Full activation requirements check
-- ============================================

CREATE OR REPLACE FUNCTION check_project_activation_requirements(p_project_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_client_po BOOLEAN;
    v_wayleaves JSONB;
    v_hs_verified BOOLEAN;
    v_contractor JSONB;
    v_can_activate BOOLEAN;
BEGIN
    -- Check each requirement
    v_client_po := check_project_has_active_client_po(p_project_id);
    v_wayleaves := check_project_wayleaves_valid(p_project_id);
    v_hs_verified := check_project_hs_verified(p_project_id);
    v_contractor := check_project_contractor_signed(p_project_id);

    -- Can only activate if all requirements met
    v_can_activate := v_client_po
        AND (v_wayleaves->>'valid')::boolean
        AND v_hs_verified
        AND (v_contractor->>'hasSigned')::boolean;

    RETURN jsonb_build_object(
        'canActivate', v_can_activate,
        'blockers', jsonb_build_object(
            'clientPO', jsonb_build_object(
                'met', v_client_po,
                'message', CASE WHEN v_client_po THEN 'Active Client PO exists' ELSE 'No active Client PO found' END
            ),
            'wayleaves', jsonb_build_object(
                'met', (v_wayleaves->>'valid')::boolean,
                'message', CASE WHEN (v_wayleaves->>'valid')::boolean THEN 'All wayleaves valid' ELSE 'Expired wayleaves found' END,
                'expired', v_wayleaves->'expired'
            ),
            'hsCompliance', jsonb_build_object(
                'met', v_hs_verified,
                'message', CASE WHEN v_hs_verified THEN 'H&S verified' ELSE 'H&S verification not completed' END
            ),
            'contractorSigned', jsonb_build_object(
                'met', (v_contractor->>'hasSigned')::boolean,
                'message', CASE WHEN (v_contractor->>'hasSigned')::boolean
                    THEN 'Contractor has signed agreement(s): ' || (v_contractor->'signedAgreements')::text
                    ELSE 'No signed SOW/MBA found'
                END,
                'signedAgreements', v_contractor->'signedAgreements'
            )
        ),
        'summary', jsonb_build_object(
            'total', 4,
            'met', (CASE WHEN v_client_po THEN 1 ELSE 0 END
                  + CASE WHEN (v_wayleaves->>'valid')::boolean THEN 1 ELSE 0 END
                  + CASE WHEN v_hs_verified THEN 1 ELSE 0 END
                  + CASE WHEN (v_contractor->>'hasSigned')::boolean THEN 1 ELSE 0 END)
        )
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. Trigger: Auto-complete client_po requirement when PO becomes active
-- ============================================

CREATE OR REPLACE FUNCTION auto_complete_client_po_requirement()
RETURNS TRIGGER AS $$
BEGIN
    -- When a Client PO becomes active, mark the client_po requirement as complete
    IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
        UPDATE project_requirements
        SET
            is_completed = true,
            completed_at = NOW(),
            completed_by = NEW.created_by,
            document_id = NEW.id::uuid
        WHERE project_id = NEW.project_id
        AND requirement_type = 'client_po'
        AND is_completed = false;
    END IF;

    -- When a Client PO becomes inactive and there are no other active POs, revert the requirement
    IF OLD.status = 'active' AND NEW.status != 'active' THEN
        IF NOT EXISTS (
            SELECT 1 FROM client_purchase_orders
            WHERE project_id = NEW.project_id
            AND status = 'active'
            AND id != NEW.id
        ) THEN
            UPDATE project_requirements
            SET
                is_completed = false,
                completed_at = NULL,
                completed_by = NULL,
                document_id = NULL
            WHERE project_id = NEW.project_id
            AND requirement_type = 'client_po';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_po_requirement_auto_complete ON client_purchase_orders;
CREATE TRIGGER trg_client_po_requirement_auto_complete
    AFTER INSERT OR UPDATE OF status ON client_purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION auto_complete_client_po_requirement();

-- ============================================
-- 9. Trigger: Auto-complete contractor requirements when agreement signed
-- ============================================

CREATE OR REPLACE FUNCTION auto_complete_contractor_requirements()
RETURNS TRIGGER AS $$
BEGIN
    -- When SOW is signed
    IF NEW.agreement_type = 'sow' AND NEW.status IN ('signed', 'active') THEN
        UPDATE project_requirements
        SET
            is_completed = true,
            completed_at = NOW(),
            completed_by = NEW.created_by,
            document_id = NEW.id::uuid
        WHERE project_id = NEW.project_id
        AND requirement_type = 'sow_signed'
        AND is_completed = false;
    END IF;

    -- When MBA is signed
    IF NEW.agreement_type = 'mba' AND NEW.status IN ('signed', 'active') THEN
        UPDATE project_requirements
        SET
            is_completed = true,
            completed_at = NOW(),
            completed_by = NEW.created_by,
            document_id = NEW.id::uuid
        WHERE project_id = NEW.project_id
        AND requirement_type = 'mba_signed'
        AND is_completed = false;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contractor_agreement_requirement_auto_complete ON contractor_agreements;
CREATE TRIGGER trg_contractor_agreement_requirement_auto_complete
    AFTER INSERT OR UPDATE OF status ON contractor_agreements
    FOR EACH ROW
    EXECUTE FUNCTION auto_complete_contractor_requirements();

-- ============================================
-- 10. Add unique constraint for requirement_type per project (prevent duplicates)
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_requirements_unique_type
ON project_requirements (project_id, requirement_type, stage);

-- ============================================
-- 11. Comments
-- ============================================

COMMENT ON FUNCTION check_project_has_active_client_po IS 'Checks if project has at least one active Client Purchase Order';
COMMENT ON FUNCTION check_project_wayleaves_valid IS 'Checks if all pipeline wayleave approvals are valid (not expired)';
COMMENT ON FUNCTION check_project_hs_verified IS 'Checks if H&S verification requirement is completed';
COMMENT ON FUNCTION check_project_contractor_signed IS 'Checks if contractor has signed SOW or MBA';
COMMENT ON FUNCTION check_project_activation_requirements IS 'Full check of all activation requirements for planning → active transition';
COMMENT ON FUNCTION auto_complete_client_po_requirement IS 'Auto-completes client_po requirement when a Client PO becomes active';
COMMENT ON FUNCTION auto_complete_contractor_requirements IS 'Auto-completes SOW/MBA requirements when contractor agreement is signed';
