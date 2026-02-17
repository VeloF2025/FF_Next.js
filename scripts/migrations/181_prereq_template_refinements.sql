-- Migration 181: Pre-req template refinements
-- 1. Add Client MSA, MSS, SOW Uploaded to VF Standard template
-- 2. Update seed_project_requirements to use specific items
-- 3. Switch Lawley to VF Standard template
-- Created: 2026-02-17

-- ============================================================================
-- 1. ADD NEW ITEMS TO VF STANDARD TEMPLATE
-- ============================================================================

-- Client MSA in site_assignments (before BSS)
INSERT INTO project_prereq_templates (template_name, phase, sort_order, requirement_type, description, responsible_party)
VALUES
    ('VF Standard', 'site_assignments', 46, 'client_msa',  'Client MSA signed',                 'client'),
    ('VF Standard', 'site_assignments', 47, 'mss_signed',  'MSS signed',                        'velocity'),
    ('VF Standard', 'contractor_engagements', 48, 'sow_uploaded', 'SOW uploaded to FibreFlow',   'velocity')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. UPDATE SEED FUNCTION (for new projects using activation-check seed)
-- ============================================================================

CREATE OR REPLACE FUNCTION seed_project_requirements(p_project_id UUID)
RETURNS void AS $$
BEGIN
    -- Pipeline requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'wayleave',      'Municipal Wayleaves',     'Obtain municipal wayleave approvals',          'pipeline', 1),
        (p_project_id, 'permit',         'Required Permits',        'Secure all necessary permits',                 'pipeline', 2),
        (p_project_id, 'client_msa',     'Client MSA Signed',       'Master Service Agreement signed with client',  'pipeline', 3),
        (p_project_id, 'feasibility',    'Feasibility Study',       'Technical feasibility confirmed',              'pipeline', 4),
        (p_project_id, 'bss_signed',     'BSS Signed',              'Build Service Schedule signed',                'pipeline', 5),
        (p_project_id, 'mss_signed',     'MSS Signed',              'Maintenance Service Schedule signed',          'pipeline', 6),
        (p_project_id, 'sow_uploaded',   'SOW Uploaded',            'SOW uploaded to FibreFlow or linked in QField','pipeline', 7)
    ON CONFLICT DO NOTHING;

    -- Planning requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'client_po',            'Client PO Active',       'At least one active Client Purchase Order',       'planning', 1),
        (p_project_id, 'boq_approved',         'BOQ Approved',           'Bill of Quantities uploaded and approved',         'planning', 2),
        (p_project_id, 'contractor_appointed',  'Contractor Appointed',   'Contractor assigned with valid documents',        'planning', 3),
        (p_project_id, 'sow_signed',           'SOW Signed',             'Scope of Work signed by contractor',              'planning', 4),
        (p_project_id, 'mba_signed',           'MBA Signed',             'Master Build Agreement signed',                   'planning', 5),
        (p_project_id, 'budget_approved',      'Budget Approved',        'Project budget allocated and approved',            'planning', 6),
        (p_project_id, 'hs_verified',          'H&S Verified',           'Health & Safety compliance verified',              'planning', 7),
        (p_project_id, 'team_assigned',        'Team Assigned',          'Project team assigned',                            'planning', 8)
    ON CONFLICT DO NOTHING;

    -- Execution requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'drops_complete', 'All Drops Installed', '100% drop completion',       'execution', 1),
        (p_project_id, 'qa_passed',      'QA Validation Passed','All installations validated', 'execution', 2)
    ON CONFLICT DO NOTHING;

    -- Closure requirements
    INSERT INTO project_requirements (project_id, requirement_type, requirement_name, description, stage, sort_order)
    VALUES
        (p_project_id, 'final_inspection', 'Final Inspection', 'Site inspection completed',  'closure', 1),
        (p_project_id, 'client_handover',  'Client Handover',  'Handover document signed',   'closure', 2)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. SWITCH LAWLEY TO VF STANDARD TEMPLATE
--    Lawley project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
-- ============================================================================

-- 3a. Record which items are completed (for restoring after switch)
CREATE TEMP TABLE IF NOT EXISTS _lawley_completed AS
SELECT requirement_type, completed_at, completed_by, notes
FROM project_requirements
WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
  AND is_completed = true;

-- 3b. Delete all existing prereqs for Lawley
DELETE FROM project_requirements
WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55';

-- 3c. Apply VF Standard template to Lawley
SELECT apply_prereq_template('4eb13426-b2a1-472d-9b3c-277082ae9b55'::UUID, 'VF Standard');

-- 3d. Restore completion status for matching requirement types
-- client_po → po_received mapping
UPDATE project_requirements pr
SET is_completed = true,
    completed_at = lc.completed_at,
    completed_by = lc.completed_by,
    notes = lc.notes
FROM _lawley_completed lc
WHERE pr.project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
  AND (
    -- Direct match (same requirement_type)
    (pr.requirement_type = lc.requirement_type)
    -- Map old activation-check types to VF Standard equivalents
    OR (lc.requirement_type = 'client_po' AND pr.requirement_type = 'po_received')
    OR (lc.requirement_type = 'sow_signed' AND pr.requirement_type = 'contractor_sow_signed')
    OR (lc.requirement_type = 'mba_signed' AND pr.requirement_type = 'contractor_mba_signed')
  );

-- Cleanup temp table
DROP TABLE IF EXISTS _lawley_completed;

-- ============================================================================
-- 4. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION seed_project_requirements IS
'Seeds activation-check prereqs for new projects (19 items). Replaced generic client_agreement/documentation with specific MSA, BSS, MSS, SOW items.';
