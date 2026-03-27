-- Migration 236: Add missing columns to hs_ticket_details
--
-- The table was created with minimal columns but the API and types
-- expect the full incident + investigation field set.

BEGIN;

-- Incident classification
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS incident_type VARCHAR(30);
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS incident_date DATE;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS incident_time TIME;

-- Location
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS incident_gps JSONB;

-- Incident details
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS immediate_actions TEXT;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS witness_names JSONB DEFAULT '[]'::jsonb;

-- Persons involved
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS injured_persons JSONB DEFAULT '[]'::jsonb;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS persons_involved JSONB DEFAULT '[]'::jsonb;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS witnesses JSONB DEFAULT '[]'::jsonb;

-- Evidence
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;

-- DoL reporting extensions
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS dol_reference VARCHAR(100);
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS dol_reported_at TIMESTAMPTZ;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS dol_reported_by UUID REFERENCES users(id);

-- Investigation workflow
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS investigation_status VARCHAR(20) DEFAULT 'pending'
  CHECK (investigation_status IN ('pending', 'assigned', 'in_progress', 'completed'));
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS investigated_by UUID REFERENCES users(id);
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS investigation_started_at TIMESTAMPTZ;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS investigation_completed_at TIMESTAMPTZ;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS contributing_factors JSONB DEFAULT '[]'::jsonb;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS investigation_findings TEXT;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS investigation_recommendations TEXT;

-- Root cause analysis (structured)
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS root_cause_method VARCHAR(20)
  CHECK (root_cause_method IN ('five_whys', 'fishbone', 'fault_tree', 'other'));
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS root_cause_analysis JSONB DEFAULT '[]'::jsonb;

-- Source audit (if created from failed audit item)
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS source_audit_id UUID;
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS source_checklist_item_id UUID;

-- Updated timestamp
ALTER TABLE hs_ticket_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hs_ticket_details_ticket ON hs_ticket_details(ticket_id);
CREATE INDEX IF NOT EXISTS idx_hs_ticket_details_severity ON hs_ticket_details(severity);
CREATE INDEX IF NOT EXISTS idx_hs_ticket_details_investigation ON hs_ticket_details(investigation_status)
  WHERE investigation_status != 'completed';

COMMIT;
