-- Migration 180: Project Pre-requisites Template
-- Reusable template table for standard project pre-requisites across 5 phases
-- Modelled on the Mamelodi PON Tracker "Pre-Reqs" sheet (45 items)

-- ============================================================================
-- 1. TEMPLATE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_prereq_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name VARCHAR(100) NOT NULL,
    phase VARCHAR(50) NOT NULL CHECK (phase IN (
        'site_assignments', 'prerequisites', 'site_establishment',
        'contractor_engagements', 'key_milestones'
    )),
    sort_order INTEGER NOT NULL,
    requirement_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    responsible_party VARCHAR(50),
    typical_duration_days INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prereq_templates_name ON project_prereq_templates(template_name);
CREATE INDEX IF NOT EXISTS idx_prereq_templates_phase ON project_prereq_templates(template_name, phase);

-- ============================================================================
-- 2. EXTEND project_requirements WITH PHASE + RESPONSIBLE PARTY
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_requirements' AND column_name = 'responsible_party') THEN
        ALTER TABLE project_requirements ADD COLUMN responsible_party VARCHAR(50);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_requirements' AND column_name = 'notes') THEN
        ALTER TABLE project_requirements ADD COLUMN notes TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_requirements' AND column_name = 'template_id') THEN
        ALTER TABLE project_requirements ADD COLUMN template_id UUID REFERENCES project_prereq_templates(id);
    END IF;
END $$;

-- ============================================================================
-- 3. SEED STANDARD VF FIBER PROJECT TEMPLATE (45 items)
-- ============================================================================

INSERT INTO project_prereq_templates (template_name, phase, sort_order, requirement_type, description, responsible_party)
VALUES
    -- Phase 1: Site Assignments (9 items)
    ('VF Standard', 'site_assignments', 1,  'site_assignment',      'Site assigned from client to VF',           'client'),
    ('VF Standard', 'site_assignments', 2,  'survey_contractor',    'Survey contractor appointed',               'velocity'),
    ('VF Standard', 'site_assignments', 3,  'hld_complete',         'HLD documentation complete',                'velocity'),
    ('VF Standard', 'site_assignments', 4,  'lld_complete',         'LLD documentation complete',                'velocity'),
    ('VF Standard', 'site_assignments', 5,  'boq_approved',         'BOQ approved',                              'velocity'),
    ('VF Standard', 'site_assignments', 6,  'bss_signed',           'BSS signed',                                'velocity'),
    ('VF Standard', 'site_assignments', 7,  'po_received',          'Purchase Order received',                   'client'),
    ('VF Standard', 'site_assignments', 8,  'budget_approved',      'Budget approved',                           'velocity'),
    ('VF Standard', 'site_assignments', 9,  'site_handover',        'Site handover meeting',                     'velocity'),

    -- Phase 2: Prerequisites (8 items)
    ('VF Standard', 'prerequisites', 10, 'wayleave_submitted',      'Wayleave application submitted',            'velocity'),
    ('VF Standard', 'prerequisites', 11, 'wayleave_approved',       'Wayleave approved',                         'velocity'),
    ('VF Standard', 'prerequisites', 12, 'environmental_assessment','Environmental assessment',                  'velocity'),
    ('VF Standard', 'prerequisites', 13, 'traffic_management',      'Traffic management plan',                   'velocity'),
    ('VF Standard', 'prerequisites', 14, 'safety_file',             'Safety file prepared',                      'fibertime'),
    ('VF Standard', 'prerequisites', 15, 'risk_assessment',         'Risk assessment complete',                  'fibertime'),
    ('VF Standard', 'prerequisites', 16, 'insurance_verified',      'Insurance verified',                        'fibertime'),
    ('VF Standard', 'prerequisites', 17, 'permits_obtained',        'All permits obtained',                      'velocity'),

    -- Phase 3: Site Establishment (7 items)
    ('VF Standard', 'site_establishment', 18, 'pop_site_secured',   'POP site secured',                          'velocity'),
    ('VF Standard', 'site_establishment', 19, 'power_connected',    'Power connected at POP',                    'velocity'),
    ('VF Standard', 'site_establishment', 20, 'olt_installed',      'OLT installed and configured',              'velocity'),
    ('VF Standard', 'site_establishment', 21, 'core_fiber_lit',     'Core fiber route lit',                      'velocity'),
    ('VF Standard', 'site_establishment', 22, 'site_office_setup',  'Site office established',                   'fibertime'),
    ('VF Standard', 'site_establishment', 23, 'materials_staged',   'Materials staged on site',                  'fibertime'),
    ('VF Standard', 'site_establishment', 24, 'vehicle_allocated',  'Vehicles allocated',                        'fibertime'),

    -- Phase 4: Contractor Engagements (7 items)
    ('VF Standard', 'contractor_engagements', 25, 'contractor_sow_signed', 'Contractor SOW signed',             'velocity'),
    ('VF Standard', 'contractor_engagements', 26, 'contractor_mba_signed', 'Contractor MBA signed',             'velocity'),
    ('VF Standard', 'contractor_engagements', 27, 'teams_inducted',        'Teams inducted on site',             'fibertime'),
    ('VF Standard', 'contractor_engagements', 28, 'ppe_issued',            'PPE issued to all teams',            'fibertime'),
    ('VF Standard', 'contractor_engagements', 29, 'qfield_setup',          'QField set up for teams',            'velocity'),
    ('VF Standard', 'contractor_engagements', 30, 'whatsapp_groups',       'WhatsApp groups created',            'velocity'),
    ('VF Standard', 'contractor_engagements', 31, 'training_complete',     'Team training complete',             'fibertime'),

    -- Phase 5: Key Milestones (14 items)
    ('VF Standard', 'key_milestones', 32, 'first_pole_planted',     'First pole planted',                        'fibertime'),
    ('VF Standard', 'key_milestones', 33, 'first_pon_strung',       'First PON fiber strung',                    'fibertime'),
    ('VF Standard', 'key_milestones', 34, 'first_splice_complete',  'First splice complete',                     'fibertime'),
    ('VF Standard', 'key_milestones', 35, 'first_home_connected',   'First home connected',                      'fibertime'),
    ('VF Standard', 'key_milestones', 36, 'first_activation',       'First activation on OES',                   'velocity'),
    ('VF Standard', 'key_milestones', 37, '25_pct_activation',      '25% activation milestone',                  'velocity'),
    ('VF Standard', 'key_milestones', 38, '50_pct_activation',      '50% activation milestone',                  'velocity'),
    ('VF Standard', 'key_milestones', 39, '75_pct_activation',      '75% activation milestone',                  'velocity'),
    ('VF Standard', 'key_milestones', 40, '90_pct_activation',      '90% activation milestone',                  'velocity'),
    ('VF Standard', 'key_milestones', 41, 'final_inspection',       'Final inspection complete',                  'velocity'),
    ('VF Standard', 'key_milestones', 42, 'as_built_submitted',     'As-built documentation submitted',          'fibertime'),
    ('VF Standard', 'key_milestones', 43, 'defects_cleared',        'All defects cleared',                       'fibertime'),
    ('VF Standard', 'key_milestones', 44, 'client_handover',        'Client handover meeting',                   'velocity'),
    ('VF Standard', 'key_milestones', 45, 'project_close',          'Project close-out',                         'velocity')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. FUNCTION: Apply template to project
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_prereq_template(
    p_project_id UUID,
    p_template_name VARCHAR DEFAULT 'VF Standard'
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    INSERT INTO project_requirements (
        project_id, requirement_type, requirement_name, description,
        stage, sort_order, responsible_party, template_id
    )
    SELECT
        p_project_id,
        t.requirement_type,
        t.description,
        t.description,
        CASE t.phase
            WHEN 'site_assignments' THEN 'pipeline'
            WHEN 'prerequisites' THEN 'pipeline'
            WHEN 'site_establishment' THEN 'planning'
            WHEN 'contractor_engagements' THEN 'planning'
            WHEN 'key_milestones' THEN 'execution'
        END,
        t.sort_order,
        t.responsible_party,
        t.id
    FROM project_prereq_templates t
    WHERE t.template_name = p_template_name
      AND t.is_active = true
    ORDER BY t.sort_order
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON TABLE project_prereq_templates IS 'Reusable pre-requisite templates for fiber build projects. Based on Mamelodi PON Tracker Pre-Reqs sheet.';
COMMENT ON FUNCTION apply_prereq_template IS 'Applies a pre-req template to a project, creating project_requirements rows. Returns count of items created.';
