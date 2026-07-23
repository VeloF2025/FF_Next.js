-- Migration: 113_health_safety_module.sql
-- Description: Health & Safety module - checklists, audits, contractor compliance, ticket integration
-- Date: 2026-01-22
--
-- ⚠️ DO NOT RUN AGAINST THE LIVE DATABASE. This file exists for fresh scratch
-- rebuilds only (scripts/hs-scratch-rebuild-proof.sh) and is deliberately NOT
-- in the auto-runner's sql/ directory. Against live, its DDL would no-op but
-- the unguarded seed INSERTs at the bottom would duplicate all 8 templates
-- (new uuids — the (template_id, item_text) unique key would not collide).
-- The idempotent live seed is scripts/migrations/sql/450_hs_checklist_seed_44.sql.
-- REGENERATED 2026-07-23 (H&S E2E remediation, goal D6): the live hs_* schema
-- was created out-of-band in Jan 2026 from DDL that never matched this file,
-- so a fresh rebuild produced tables the code (and migration 236) could not
-- use — 236 aborted on an index over a column this file never created.
-- This file now carries the LIVE schema (pg_dump-derived, live is
-- authoritative) for the nine original H&S tables, so the chain
-- 113 -> 235 -> 236 -> 237 -> 238 -> sql/449 -> sql/450 rebuilds a database
-- whose hs_* tables match production. Later migrations' IF NOT EXISTS guards
-- make them natural no-ops where this file already includes their columns.
-- The old calculate_contractor_hs_score() function was dropped from this
-- file: it never existed in the live DB and queried the long-renamed
-- "tickets" table.
--
-- Dependencies (id types): projects.id uuid, users.id uuid, staff.id uuid,
-- contractors.id uuid. hs_ticket_details.ticket_id has NO foreign key
-- (matches live — orphaned detail rows exist and are preserved as evidence).

-- ============================================
-- 1. Checklist Templates
-- ============================================
CREATE TABLE IF NOT EXISTS hs_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Checklist Items
-- ============================================
CREATE TABLE IF NOT EXISTS hs_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES hs_checklist_templates(id) ON DELETE CASCADE,
  item_text TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium',
  regulation_reference VARCHAR(255),
  sort_order INTEGER DEFAULT 0,
  is_mandatory BOOLEAN DEFAULT true,
  requires_photo BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. Project H&S Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS hs_project_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  template_id UUID REFERENCES hs_checklist_templates(id),
  audit_frequency VARCHAR(50) DEFAULT 'weekly',
  next_audit_due TIMESTAMPTZ,
  safety_officer_id INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  custom_frequency_days INTEGER,
  min_score_threshold INTEGER DEFAULT 80,
  requires_daily_briefing BOOLEAN DEFAULT true,
  height_work_permitted BOOLEAN DEFAULT false,
  hot_work_permitted BOOLEAN DEFAULT false,
  confined_space_work BOOLEAN DEFAULT false,
  excavation_work BOOLEAN DEFAULT false,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS hs_project_config_project_id_key
  ON hs_project_config(project_id);

-- ============================================
-- 4. Project Audits
-- ============================================
CREATE TABLE IF NOT EXISTS hs_project_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  config_id UUID REFERENCES hs_project_config(id),
  auditor_id UUID,
  audit_date TIMESTAMPTZ DEFAULT NOW(),
  overall_score INTEGER,
  rag_status VARCHAR(10) DEFAULT 'green',
  status VARCHAR(50) DEFAULT 'in_progress',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  audit_type VARCHAR(50) DEFAULT 'routine',
  weather_conditions TEXT,
  site_personnel_count INTEGER
);

-- ============================================
-- 5. Audit Responses
-- ============================================
CREATE TABLE IF NOT EXISTS hs_audit_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID REFERENCES hs_project_audits(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES hs_checklist_items(id),
  response VARCHAR(20) DEFAULT 'not_checked',
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. Contractor H&S Compliance
-- ============================================
CREATE TABLE IF NOT EXISTS hs_contractor_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL,
  overall_score INTEGER DEFAULT 0,
  rag_status VARCHAR(10) DEFAULT 'amber',
  last_audit_date TIMESTAMPTZ,
  next_audit_due TIMESTAMPTZ,
  safety_file_status VARCHAR(50) DEFAULT 'pending',
  documents_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 7. Contractor H&S Documents
-- (same DDL as sql/449 — IF NOT EXISTS keeps them compatible)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_contractor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  document_number VARCHAR(100),
  file_url TEXT,
  file_name VARCHAR(255),
  issue_date DATE,
  expiry_date DATE,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'valid', 'expired', 'rejected', 'expiring_soon')),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hs_contractor_docs_contractor
  ON hs_contractor_documents(contractor_id);
CREATE INDEX IF NOT EXISTS idx_hs_contractor_docs_expiry
  ON hs_contractor_documents(expiry_date)
  WHERE status NOT IN ('rejected');

-- ============================================
-- 8. H&S Ticket Details (extends maintenance tickets; no FK — see header)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_ticket_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID,
  severity VARCHAR(20),
  dol_reportable BOOLEAN DEFAULT false,
  dol_reported BOOLEAN DEFAULT false,
  corrective_action_required BOOLEAN DEFAULT false,
  root_cause TEXT,
  investigation_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  incident_type VARCHAR(30),
  incident_date DATE,
  incident_time TIME,
  location TEXT,
  incident_gps JSONB,
  description TEXT,
  immediate_actions TEXT,
  witness_names JSONB DEFAULT '[]'::jsonb,
  injured_persons JSONB DEFAULT '[]'::jsonb,
  persons_involved JSONB DEFAULT '[]'::jsonb,
  witnesses JSONB DEFAULT '[]'::jsonb,
  photos JSONB DEFAULT '[]'::jsonb,
  dol_reference VARCHAR(100),
  dol_reported_at TIMESTAMPTZ,
  dol_reported_by UUID REFERENCES users(id),
  investigation_status VARCHAR(20) DEFAULT 'pending'
    CHECK (investigation_status IN ('pending', 'assigned', 'in_progress', 'completed')),
  investigated_by UUID REFERENCES users(id),
  investigation_started_at TIMESTAMPTZ,
  investigation_completed_at TIMESTAMPTZ,
  contributing_factors JSONB DEFAULT '[]'::jsonb,
  investigation_findings TEXT,
  investigation_recommendations TEXT,
  root_cause_method VARCHAR(20)
    CHECK (root_cause_method IN ('five_whys', 'fishbone', 'fault_tree', 'other')),
  root_cause_analysis JSONB DEFAULT '[]'::jsonb,
  source_audit_id UUID,
  source_checklist_item_id UUID,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 9. H&S Activity Log (live shape: activity_type/description/metadata)
-- ============================================
CREATE TABLE IF NOT EXISTS hs_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  user_id INTEGER,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
