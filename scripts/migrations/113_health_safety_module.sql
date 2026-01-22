-- Migration: 113_health_safety_module.sql
-- Description: Health & Safety module - checklists, audits, contractor compliance, ticket integration
-- Date: 2026-01-22

-- ============================================
-- 1. Checklist Templates (reusable across projects)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL, -- working_at_heights, ppe, scaffolding, electrical, first_aid, fire, fibre_specific, site_conditions
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hs_checklist_templates IS 'Reusable H&S audit checklist templates';

-- ============================================
-- 2. Checklist Items
-- ============================================
CREATE TABLE IF NOT EXISTS hs_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES hs_checklist_templates(id) ON DELETE CASCADE,
  item_text TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  regulation_reference VARCHAR(255), -- e.g., "OHS Act 85/1993 s8(1)", "Construction Reg 8"
  sort_order INTEGER DEFAULT 0,
  is_mandatory BOOLEAN DEFAULT true,
  requires_photo BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hs_checklist_items IS 'Individual items within H&S checklist templates';
COMMENT ON COLUMN hs_checklist_items.regulation_reference IS 'SA regulation reference (OHS Act, Construction Regs, SANS)';

-- ============================================
-- 3. Project H&S Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS hs_project_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id UUID REFERENCES hs_checklist_templates(id),

  -- Audit scheduling
  audit_frequency VARCHAR(50) DEFAULT 'weekly' CHECK (audit_frequency IN ('daily', 'weekly', 'fortnightly', 'monthly', 'custom')),
  custom_frequency_days INTEGER,
  next_audit_due DATE,

  -- Thresholds
  min_score_threshold INTEGER DEFAULT 80 CHECK (min_score_threshold BETWEEN 0 AND 100),

  -- Special work permits
  requires_daily_briefing BOOLEAN DEFAULT true,
  height_work_permitted BOOLEAN DEFAULT false,
  hot_work_permitted BOOLEAN DEFAULT false,
  confined_space_work BOOLEAN DEFAULT false,
  excavation_work BOOLEAN DEFAULT false,

  -- Metadata
  notes TEXT,
  created_by INTEGER REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_id)
);

COMMENT ON TABLE hs_project_config IS 'Project-specific H&S configuration and audit settings';

-- ============================================
-- 4. Project Audits
-- ============================================
CREATE TABLE IF NOT EXISTS hs_project_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  auditor_id INTEGER REFERENCES staff(id),

  -- Audit details
  audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  audit_type VARCHAR(50) DEFAULT 'routine' CHECK (audit_type IN ('routine', 'spot_check', 'follow_up', 'incident_triggered', 'pre_work')),

  -- Scoring
  overall_score INTEGER CHECK (overall_score BETWEEN 0 AND 100),
  rag_status VARCHAR(10) CHECK (rag_status IN ('red', 'amber', 'green')),

  -- Status
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'requires_action', 'cancelled')),

  -- Context
  notes TEXT,
  photos JSONB DEFAULT '[]', -- Array of {url, caption, timestamp}
  weather_conditions VARCHAR(100),
  site_personnel_count INTEGER,

  -- Timestamps
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hs_project_audits IS 'H&S audit records for projects';

-- ============================================
-- 5. Audit Responses (individual checklist answers)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_audit_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES hs_project_audits(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES hs_checklist_items(id),

  -- Response
  response VARCHAR(20) NOT NULL CHECK (response IN ('pass', 'fail', 'na', 'not_checked')),
  notes TEXT,
  photo_url TEXT,

  -- Follow-up
  corrective_action_required BOOLEAN DEFAULT false,
  ticket_created BOOLEAN DEFAULT false,
  ticket_id UUID, -- References tickets table when created

  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hs_audit_responses IS 'Individual responses to audit checklist items';

-- ============================================
-- 6. Contractor H&S Compliance (calculated scores)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_contractor_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,

  -- Overall score
  overall_score INTEGER DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 100),
  rag_status VARCHAR(10) DEFAULT 'red' CHECK (rag_status IN ('red', 'amber', 'green')),

  -- Score breakdown
  document_score INTEGER DEFAULT 0 CHECK (document_score BETWEEN 0 AND 100),
  incident_score INTEGER DEFAULT 100 CHECK (incident_score BETWEEN 0 AND 100), -- Starts at 100, decreases with incidents
  training_score INTEGER DEFAULT 0 CHECK (training_score BETWEEN 0 AND 100),
  corrective_action_score INTEGER DEFAULT 100 CHECK (corrective_action_score BETWEEN 0 AND 100),
  audit_score INTEGER DEFAULT 0 CHECK (audit_score BETWEEN 0 AND 100),

  -- Audit tracking
  last_audit_date DATE,
  next_audit_due DATE,

  -- Gate status
  is_gate_approved BOOLEAN DEFAULT false,
  gate_blockers JSONB DEFAULT '[]', -- Array of blocker strings
  gate_warnings JSONB DEFAULT '[]', -- Array of warning strings

  -- Calculation metadata
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(contractor_id)
);

COMMENT ON TABLE hs_contractor_compliance IS 'Calculated H&S compliance scores for contractors';
COMMENT ON COLUMN hs_contractor_compliance.is_gate_approved IS 'Whether contractor can be assigned to projects (hard block if false)';

-- ============================================
-- 7. Contractor H&S Documents
-- ============================================
CREATE TABLE IF NOT EXISTS hs_contractor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,

  -- Document info
  document_type VARCHAR(100) NOT NULL CHECK (document_type IN (
    'safety_policy',           -- Required for gate
    'liability_insurance',     -- Required for gate
    'safety_plan',             -- Required for gate
    'training_certs',          -- Training certificates
    'medical_fitness',         -- Medical fitness certificates
    'equipment_inspection',    -- Equipment inspection records
    'risk_assessment',         -- Site-specific risk assessments
    'other'
  )),
  document_name VARCHAR(255) NOT NULL,
  file_url TEXT,
  file_size INTEGER, -- bytes

  -- Validity
  issue_date DATE,
  expiry_date DATE,

  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verified_by INTEGER REFERENCES staff(id),
  verified_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'expired', 'rejected', 'expiring_soon')),
  rejection_reason TEXT,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hs_contractor_documents IS 'H&S documents uploaded by contractors (policies, insurance, certificates)';

-- ============================================
-- 8. H&S Ticket Details (extends maintenance tickets)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_ticket_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

  -- H&S-specific classification
  hs_incident_type VARCHAR(50) CHECK (hs_incident_type IN ('injury', 'near_miss', 'property_damage', 'environmental', 'vehicle', 'other')),
  hs_severity VARCHAR(20) CHECK (hs_severity IN ('minor', 'moderate', 'major', 'fatal')),

  -- Incident details
  incident_date TIMESTAMPTZ,
  incident_location TEXT,
  incident_gps JSONB, -- {lat, lng}
  witness_names TEXT[],
  immediate_actions TEXT,

  -- Persons involved
  persons_involved JSONB DEFAULT '[]', -- Array of {name, role, injuries, treatment}

  -- DoL reporting (SA requirement)
  is_dol_reportable BOOLEAN DEFAULT false,
  dol_reference VARCHAR(100),
  dol_reported_at TIMESTAMPTZ,
  dol_reported_by INTEGER REFERENCES staff(id),

  -- Investigation fields
  root_cause TEXT,
  contributing_factors TEXT[],
  investigation_findings TEXT,
  investigation_recommendations TEXT,
  investigated_by INTEGER REFERENCES staff(id),
  investigation_started_at TIMESTAMPTZ,
  investigation_completed_at TIMESTAMPTZ,

  -- Link to audit if triggered by failed audit item
  source_audit_id UUID REFERENCES hs_project_audits(id),
  source_checklist_item_id UUID REFERENCES hs_checklist_items(id),

  -- Evidence
  photos JSONB DEFAULT '[]', -- Array of {url, caption, timestamp}

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(ticket_id)
);

COMMENT ON TABLE hs_ticket_details IS 'H&S-specific fields for maintenance tickets (incidents, near-misses)';
COMMENT ON COLUMN hs_ticket_details.is_dol_reportable IS 'Whether incident must be reported to Department of Labour per OHS Act';

-- ============================================
-- 9. H&S Activity Log
-- ============================================
CREATE TABLE IF NOT EXISTS hs_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('project_config', 'project_audit', 'contractor_compliance', 'contractor_document', 'ticket')),
  entity_id UUID NOT NULL,

  -- Action
  action VARCHAR(50) NOT NULL, -- created, updated, completed, approved, rejected, expired, etc.

  -- Actor
  actor_id INTEGER REFERENCES staff(id),

  -- Details
  details JSONB,
  previous_values JSONB, -- For tracking changes

  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hs_activity_log IS 'Audit trail for all H&S module actions';

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_hs_checklist_templates_category ON hs_checklist_templates(category);
CREATE INDEX idx_hs_checklist_templates_active ON hs_checklist_templates(is_active) WHERE is_active = true;

CREATE INDEX idx_hs_checklist_items_template ON hs_checklist_items(template_id);
CREATE INDEX idx_hs_checklist_items_category ON hs_checklist_items(category);

CREATE INDEX idx_hs_project_config_project ON hs_project_config(project_id);
CREATE INDEX idx_hs_project_config_next_audit ON hs_project_config(next_audit_due);

CREATE INDEX idx_hs_project_audits_project ON hs_project_audits(project_id);
CREATE INDEX idx_hs_project_audits_date ON hs_project_audits(audit_date);
CREATE INDEX idx_hs_project_audits_status ON hs_project_audits(status);
CREATE INDEX idx_hs_project_audits_auditor ON hs_project_audits(auditor_id);

CREATE INDEX idx_hs_audit_responses_audit ON hs_audit_responses(audit_id);
CREATE INDEX idx_hs_audit_responses_item ON hs_audit_responses(checklist_item_id);
CREATE INDEX idx_hs_audit_responses_ticket ON hs_audit_responses(ticket_id) WHERE ticket_id IS NOT NULL;

CREATE INDEX idx_hs_contractor_compliance_contractor ON hs_contractor_compliance(contractor_id);
CREATE INDEX idx_hs_contractor_compliance_rag ON hs_contractor_compliance(rag_status);
CREATE INDEX idx_hs_contractor_compliance_gate ON hs_contractor_compliance(is_gate_approved);

CREATE INDEX idx_hs_contractor_documents_contractor ON hs_contractor_documents(contractor_id);
CREATE INDEX idx_hs_contractor_documents_type ON hs_contractor_documents(document_type);
CREATE INDEX idx_hs_contractor_documents_status ON hs_contractor_documents(status);
CREATE INDEX idx_hs_contractor_documents_expiry ON hs_contractor_documents(expiry_date);

CREATE INDEX idx_hs_ticket_details_ticket ON hs_ticket_details(ticket_id);
CREATE INDEX idx_hs_ticket_details_audit ON hs_ticket_details(source_audit_id) WHERE source_audit_id IS NOT NULL;
CREATE INDEX idx_hs_ticket_details_type ON hs_ticket_details(hs_incident_type);
CREATE INDEX idx_hs_ticket_details_severity ON hs_ticket_details(hs_severity);

CREATE INDEX idx_hs_activity_log_entity ON hs_activity_log(entity_type, entity_id);
CREATE INDEX idx_hs_activity_log_created ON hs_activity_log(created_at);

-- ============================================
-- SEED DATA: Default Checklist Templates
-- ============================================
INSERT INTO hs_checklist_templates (name, category, description, is_default, is_active) VALUES
('Working at Heights - Standard', 'working_at_heights', 'Fall protection and height work safety per Construction Reg 8', true, true),
('PPE Compliance - Standard', 'ppe', 'Personal protective equipment checks per OHS Act s8(2)(d)', true, true),
('Scaffolding Safety - SANS 10085', 'scaffolding', 'Scaffolding safety per SANS 10085 and Construction Reg 16', true, true),
('Electrical Safety - Standard', 'electrical', 'Electrical safety and lock-out/tag-out procedures', true, true),
('First Aid Readiness', 'first_aid', 'First aid equipment and personnel per General Safety Reg 3', true, true),
('Fire Safety - Standard', 'fire', 'Fire prevention and emergency equipment per Construction Reg 29', true, true),
('Fibre-Specific Safety', 'fibre_specific', 'Fibre optic installation specific hazards (glass, laser, chemicals)', true, true),
('Site Conditions - General', 'site_conditions', 'General site housekeeping and welfare per Construction Reg 24-26', true, true);

-- Get template IDs for seeding items
DO $$
DECLARE
  v_heights_id UUID;
  v_ppe_id UUID;
  v_scaffolding_id UUID;
  v_electrical_id UUID;
  v_first_aid_id UUID;
  v_fire_id UUID;
  v_fibre_id UUID;
  v_site_id UUID;
BEGIN
  SELECT id INTO v_heights_id FROM hs_checklist_templates WHERE category = 'working_at_heights' AND is_default = true LIMIT 1;
  SELECT id INTO v_ppe_id FROM hs_checklist_templates WHERE category = 'ppe' AND is_default = true LIMIT 1;
  SELECT id INTO v_scaffolding_id FROM hs_checklist_templates WHERE category = 'scaffolding' AND is_default = true LIMIT 1;
  SELECT id INTO v_electrical_id FROM hs_checklist_templates WHERE category = 'electrical' AND is_default = true LIMIT 1;
  SELECT id INTO v_first_aid_id FROM hs_checklist_templates WHERE category = 'first_aid' AND is_default = true LIMIT 1;
  SELECT id INTO v_fire_id FROM hs_checklist_templates WHERE category = 'fire' AND is_default = true LIMIT 1;
  SELECT id INTO v_fibre_id FROM hs_checklist_templates WHERE category = 'fibre_specific' AND is_default = true LIMIT 1;
  SELECT id INTO v_site_id FROM hs_checklist_templates WHERE category = 'site_conditions' AND is_default = true LIMIT 1;

  -- Working at Heights items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_heights_id, 'Fall protection plan available and communicated to workers', 'working_at_heights', 'critical', 'Construction Reg 8(1)', 1, true, false),
  (v_heights_id, 'Full body harnesses inspected and in good condition', 'working_at_heights', 'critical', 'Construction Reg 8(5)', 2, true, true),
  (v_heights_id, 'Anchor points certified and load-tested', 'working_at_heights', 'critical', 'Construction Reg 8(6)', 3, true, false),
  (v_heights_id, 'Ladders secured and at correct angle (4:1 ratio)', 'working_at_heights', 'high', 'Construction Reg 13', 4, true, false),
  (v_heights_id, 'Workers have valid medical fitness certificates for height work', 'working_at_heights', 'critical', 'Construction Reg 8(7)', 5, true, false),
  (v_heights_id, 'Guardrails installed where required (work >2m)', 'working_at_heights', 'critical', 'Construction Reg 10', 6, true, true),
  (v_heights_id, 'Safety nets in place for elevated work areas', 'working_at_heights', 'high', 'Construction Reg 10(2)', 7, false, true);

  -- PPE items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_ppe_id, 'Hard hats worn in designated areas', 'ppe', 'high', 'OHS Act s8(2)(d)', 1, true, false),
  (v_ppe_id, 'Safety boots with steel toe caps worn by all workers', 'ppe', 'high', 'General Safety Reg 2', 2, true, false),
  (v_ppe_id, 'Hi-visibility vests worn near traffic or vehicles', 'ppe', 'high', 'General Safety Reg 2', 3, true, false),
  (v_ppe_id, 'Safety glasses available and used for fibre work', 'ppe', 'high', 'General Safety Reg 2', 4, true, false),
  (v_ppe_id, 'Appropriate gloves provided for task', 'ppe', 'medium', 'General Safety Reg 2', 5, true, false),
  (v_ppe_id, 'Hearing protection available where noise exceeds 85dB', 'ppe', 'medium', 'Noise Induced Hearing Loss Reg', 6, false, false);

  -- Scaffolding items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_scaffolding_id, 'Scaffold erected by competent person', 'scaffolding', 'critical', 'Construction Reg 16(1)', 1, true, false),
  (v_scaffolding_id, 'Weekly scaffold inspection records current', 'scaffolding', 'high', 'Construction Reg 16(3)', 2, true, false),
  (v_scaffolding_id, 'Safe working load clearly displayed on scaffold', 'scaffolding', 'high', 'SANS 10085', 3, true, true),
  (v_scaffolding_id, 'Toe boards and guardrails in place', 'scaffolding', 'high', 'Construction Reg 16(2)', 4, true, true),
  (v_scaffolding_id, 'Access ladders secured and positioned correctly', 'scaffolding', 'high', 'Construction Reg 13', 5, true, false);

  -- Electrical items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_electrical_id, 'Lock-out/tag-out procedures followed', 'electrical', 'critical', 'Electrical Installation Reg', 1, true, false),
  (v_electrical_id, 'Permit to work in place for electrical tasks', 'electrical', 'critical', 'OHS Act s8(2)(h)', 2, true, false),
  (v_electrical_id, 'Safe working distance from power lines maintained', 'electrical', 'critical', 'Construction Reg 22', 3, true, false),
  (v_electrical_id, 'Electrical tools inspected and tagged', 'electrical', 'high', 'General Safety Reg 2A', 4, true, false),
  (v_electrical_id, 'Extension cables protected from damage', 'electrical', 'medium', 'General Safety Reg 2A', 5, true, false);

  -- First Aid items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_first_aid_id, 'First aid kit stocked and accessible', 'first_aid', 'high', 'General Safety Reg 3', 1, true, true),
  (v_first_aid_id, 'Trained first aider present on site', 'first_aid', 'high', 'General Safety Reg 3', 2, true, false),
  (v_first_aid_id, 'Emergency contact numbers displayed', 'first_aid', 'medium', 'General Safety Reg 3', 3, true, true),
  (v_first_aid_id, 'Eye wash station available for fibre work', 'first_aid', 'high', 'General Safety Reg 3', 4, true, true),
  (v_first_aid_id, 'Emergency evacuation plan communicated', 'first_aid', 'high', 'General Safety Reg 9', 5, true, false);

  -- Fire Safety items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_fire_id, 'Fire extinguishers serviced and accessible', 'fire', 'high', 'Construction Reg 29', 1, true, true),
  (v_fire_id, 'Hot work permit in place where required', 'fire', 'critical', 'Construction Reg 29(2)', 2, false, false),
  (v_fire_id, 'Flammable materials stored correctly', 'fire', 'high', 'Construction Reg 29(1)', 3, true, false),
  (v_fire_id, 'Fire escape routes clear and signed', 'fire', 'high', 'General Safety Reg 9', 4, true, true);

  -- Fibre-Specific items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_fibre_id, 'Fibre scraps disposed in sealed container', 'fibre_specific', 'high', 'Best Practice', 1, true, true),
  (v_fibre_id, 'No eating or drinking in splicing area', 'fibre_specific', 'medium', 'Best Practice', 2, true, false),
  (v_fibre_id, 'Laser safety glasses worn for OTDR work', 'fibre_specific', 'critical', 'Best Practice', 3, true, false),
  (v_fibre_id, 'Adequate ventilation for epoxy curing', 'fibre_specific', 'high', 'Hazardous Chemical Substances Reg', 4, true, false),
  (v_fibre_id, 'Warning signs for laser equipment displayed', 'fibre_specific', 'high', 'Best Practice', 5, true, true),
  (v_fibre_id, 'Cleave waste container on-site and used', 'fibre_specific', 'medium', 'Best Practice', 6, true, true);

  -- Site Conditions items
  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_site_id, 'Site perimeter secured appropriately', 'site_conditions', 'medium', 'Construction Reg 24', 1, true, false),
  (v_site_id, 'Adequate lighting for work areas', 'site_conditions', 'medium', 'Construction Reg 25', 2, true, false),
  (v_site_id, 'Housekeeping maintained (no trip hazards)', 'site_conditions', 'medium', 'Construction Reg 26', 3, true, true),
  (v_site_id, 'Welfare facilities adequate (toilets, water)', 'site_conditions', 'medium', 'Construction Reg 30', 4, true, false),
  (v_site_id, 'Safety signage visible and current', 'site_conditions', 'medium', 'Construction Reg 24(b)', 5, true, true),
  (v_site_id, 'Excavations protected and supported', 'site_conditions', 'critical', 'Construction Reg 13', 6, false, true);
END $$;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to calculate contractor H&S score
CREATE OR REPLACE FUNCTION calculate_contractor_hs_score(p_contractor_id INTEGER)
RETURNS TABLE (
  overall_score INTEGER,
  rag_status VARCHAR(10),
  document_score INTEGER,
  incident_score INTEGER,
  training_score INTEGER,
  corrective_action_score INTEGER,
  audit_score INTEGER,
  gate_approved BOOLEAN,
  blockers TEXT[]
) AS $$
DECLARE
  v_doc_score INTEGER := 0;
  v_doc_total INTEGER := 0;
  v_doc_valid INTEGER := 0;
  v_incident_score INTEGER := 100;
  v_training_score INTEGER := 0;
  v_ca_score INTEGER := 100;
  v_audit_score INTEGER := 0;
  v_overall INTEGER := 0;
  v_rag VARCHAR(10);
  v_blockers TEXT[] := ARRAY[]::TEXT[];
  v_required_docs TEXT[] := ARRAY['safety_policy', 'liability_insurance', 'safety_plan'];
  v_doc_type TEXT;
  v_incidents RECORD;
BEGIN
  -- Document score (25% weight)
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'valid')
  INTO v_doc_total, v_doc_valid
  FROM hs_contractor_documents
  WHERE contractor_id = p_contractor_id;

  IF v_doc_total > 0 THEN
    v_doc_score := ROUND((v_doc_valid::NUMERIC / v_doc_total) * 100);
  END IF;

  -- Check required documents for gate
  FOREACH v_doc_type IN ARRAY v_required_docs LOOP
    IF NOT EXISTS (
      SELECT 1 FROM hs_contractor_documents
      WHERE contractor_id = p_contractor_id
      AND document_type = v_doc_type
      AND status = 'valid'
    ) THEN
      v_blockers := array_append(v_blockers, 'Missing valid ' || replace(v_doc_type, '_', ' '));
    END IF;
  END LOOP;

  -- Incident score (30% weight) - deduct for H&S tickets in last 12 months
  SELECT
    COALESCE(SUM(CASE WHEN htd.hs_severity = 'minor' THEN 5 ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN htd.hs_severity = 'moderate' THEN 15 ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN htd.hs_severity = 'major' THEN 30 ELSE 0 END), 0) +
    COALESCE(SUM(CASE WHEN htd.hs_severity = 'fatal' THEN 50 ELSE 0 END), 0) AS penalty,
    COUNT(*) FILTER (WHERE htd.hs_severity IN ('major', 'fatal')) AS major_count
  INTO v_incidents
  FROM tickets t
  JOIN hs_ticket_details htd ON htd.ticket_id = t.id
  WHERE t.assigned_contractor_id = p_contractor_id::TEXT
  AND t.ticket_type IN ('hse_incident', 'hse_near_miss')
  AND t.created_at >= NOW() - INTERVAL '12 months';

  v_incident_score := GREATEST(0, 100 - COALESCE(v_incidents.penalty, 0));

  IF COALESCE(v_incidents.major_count, 0) > 0 THEN
    v_blockers := array_append(v_blockers, v_incidents.major_count || ' major/fatal incident(s) in last 12 months');
  END IF;

  -- Training score (15% weight) - placeholder, can integrate with staff training
  v_training_score := 70; -- Default until training module integration

  -- Corrective action score (15% weight)
  -- Based on overdue tickets
  SELECT 100 - (COUNT(*) * 10)
  INTO v_ca_score
  FROM tickets t
  WHERE t.assigned_contractor_id = p_contractor_id::TEXT
  AND t.ticket_type IN ('hse_incident', 'hse_near_miss')
  AND t.status NOT IN ('closed', 'cancelled')
  AND t.sla_due_at < NOW();

  v_ca_score := GREATEST(0, COALESCE(v_ca_score, 100));

  -- Audit score (15% weight) - average of recent project audits
  SELECT COALESCE(AVG(hpa.overall_score), 0)::INTEGER
  INTO v_audit_score
  FROM hs_project_audits hpa
  JOIN hs_project_config hpc ON hpc.project_id = hpa.project_id
  JOIN contractor_projects cp ON cp.project_id = hpc.project_id
  WHERE cp.contractor_id = p_contractor_id
  AND hpa.status = 'completed'
  AND hpa.audit_date >= NOW() - INTERVAL '6 months';

  -- Calculate overall (weighted)
  v_overall := ROUND(
    (v_doc_score * 0.25) +
    (v_incident_score * 0.30) +
    (v_training_score * 0.15) +
    (v_ca_score * 0.15) +
    (v_audit_score * 0.15)
  );

  -- Determine RAG status
  IF v_overall < 50 THEN
    v_rag := 'red';
    v_blockers := array_append(v_blockers, 'H&S score (' || v_overall || '%) below minimum (50%)');
  ELSIF v_overall < 80 THEN
    v_rag := 'amber';
  ELSE
    v_rag := 'green';
  END IF;

  RETURN QUERY SELECT
    v_overall,
    v_rag,
    v_doc_score,
    v_incident_score,
    v_training_score,
    v_ca_score,
    v_audit_score,
    (array_length(v_blockers, 1) IS NULL OR array_length(v_blockers, 1) = 0),
    v_blockers;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_contractor_hs_score IS 'Calculates H&S compliance score for a contractor with gate check';
