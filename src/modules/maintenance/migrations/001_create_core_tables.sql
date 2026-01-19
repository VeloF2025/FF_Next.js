-- Ticketing Module - Core Tables Migration
-- Creates 8 core tables for ticket management, verification, imports, and integrations
--
-- Tables created:
--   1. tickets - Core ticket table
--   2. verification_steps - 12-step verification tracking
--   3. weekly_reports - Import batch tracking
--   4. qcontact_sync_log - Bidirectional sync audit
--   5. guarantee_periods - Guarantee configuration by project
--   6. whatsapp_notifications - Notification delivery tracking
--   7. ticket_attachments - File metadata
--   8. ticket_notes - Internal/client notes

-- Note: Assumes the following tables already exist:
--   - projects (referenced by tickets, guarantee_periods)
--   - users (referenced by tickets, verification_steps, etc.)
--   - contractors (referenced by tickets)

-- 1. tickets - Core ticket table
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_uid VARCHAR(20) UNIQUE NOT NULL, -- e.g., FT406824

  -- Source tracking
  source VARCHAR(20) NOT NULL,
  external_id VARCHAR(100), -- QContact ticket ID, report line ID, etc.

  -- Core fields
  title VARCHAR(255) NOT NULL,
  description TEXT,
  ticket_type VARCHAR(50) NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(30) DEFAULT 'open',

  -- Location
  dr_number VARCHAR(50),
  project_id UUID,
  zone_id UUID,
  pole_number VARCHAR(50),
  pon_number VARCHAR(50),
  address TEXT,
  gps_coordinates POINT,

  -- Equipment
  ont_serial VARCHAR(100),
  ont_rx_level DECIMAL(5,2), -- Fiber power level in dBm
  ont_model VARCHAR(100),

  -- Assignment
  assigned_to UUID,
  assigned_contractor_id UUID,
  assigned_team VARCHAR(100),

  -- Guarantee
  guarantee_status VARCHAR(20), -- 'under_guarantee', 'out_of_guarantee', 'pending_classification'
  guarantee_expires_at TIMESTAMP,
  is_billable BOOLEAN,
  billing_classification VARCHAR(50),

  -- Verification (from maintenance requirements)
  qa_ready BOOLEAN DEFAULT false,
  qa_readiness_check_at TIMESTAMP,
  qa_readiness_failed_reasons JSONB, -- Array of failed checks

  -- Fault Attribution (from maintenance requirements)
  fault_cause VARCHAR(50),
  fault_cause_details TEXT,

  -- Rectification tracking
  rectification_count INTEGER DEFAULT 0, -- Number of fix attempts

  -- SLA
  sla_due_at TIMESTAMP,
  sla_first_response_at TIMESTAMP,
  sla_breached BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP,
  closed_by UUID,

  -- Constraints
  CHECK (source IN ('qcontact', 'weekly_report', 'construction', 'ad_hoc', 'incident', 'revenue', 'ont_swap')),
  CHECK (priority IN ('low', 'normal', 'high', 'urgent', 'critical')),
  CHECK (fault_cause IN ('workmanship', 'material_failure', 'client_damage', 'third_party', 'environmental', 'vandalism', 'unknown') OR fault_cause IS NULL)
);

-- Comments for documentation
COMMENT ON TABLE tickets IS 'Core ticket table for managing fiber network issues, faults, and maintenance requests';
COMMENT ON COLUMN tickets.ticket_uid IS 'Unique human-readable ticket identifier (e.g., FT406824)';
COMMENT ON COLUMN tickets.source IS 'Source system: qcontact, weekly_report, construction, ad_hoc, incident, revenue, ont_swap';
COMMENT ON COLUMN tickets.fault_cause IS '7 fault categories: workmanship, material_failure, client_damage, third_party, environmental, vandalism, unknown';
COMMENT ON COLUMN tickets.qa_ready IS 'Boolean flag indicating if ticket passes pre-QA readiness validation';
COMMENT ON COLUMN tickets.rectification_count IS 'Number of times ticket has been sent back for corrections';

-- 2. verification_steps - 12-step verification tracking
CREATE TABLE IF NOT EXISTS verification_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,
  step_number INTEGER NOT NULL, -- 1-12
  step_name VARCHAR(100) NOT NULL,
  step_description TEXT,

  -- Completion
  is_complete BOOLEAN DEFAULT false,
  completed_at TIMESTAMP,
  completed_by UUID,

  -- Evidence
  photo_required BOOLEAN DEFAULT false,
  photo_url TEXT,
  photo_verified BOOLEAN DEFAULT false, -- Photo passed quality check
  notes TEXT,

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(ticket_id, step_number)
);

COMMENT ON TABLE verification_steps IS '12-step verification checklist for ticket completion and QA approval';
COMMENT ON COLUMN verification_steps.step_number IS 'Step number 1-12 in the verification sequence';
COMMENT ON COLUMN verification_steps.photo_verified IS 'Indicates if photo passed quality validation (relevance, sequence, reuse detection)';

-- 3. weekly_reports - Import batch tracking
CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_uid VARCHAR(20) UNIQUE NOT NULL, -- e.g., WR2024-W51

  -- Import details
  week_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  report_date DATE NOT NULL,

  -- Source file
  original_filename VARCHAR(255),
  file_path TEXT,

  -- Import stats
  total_rows INTEGER,
  imported_count INTEGER,
  skipped_count INTEGER,
  error_count INTEGER,
  errors JSONB, -- Array of error details

  -- Status
  status VARCHAR(20) DEFAULT 'pending',

  imported_at TIMESTAMP,
  imported_by UUID,

  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

COMMENT ON TABLE weekly_reports IS 'Tracks weekly Excel report imports (93+ items per report)';
COMMENT ON COLUMN weekly_reports.report_uid IS 'Unique report identifier (e.g., WR2024-W51)';
COMMENT ON COLUMN weekly_reports.errors IS 'JSON array of import error details with row numbers and reasons';

-- 4. qcontact_sync_log - Bidirectional sync audit
CREATE TABLE IF NOT EXISTS qcontact_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID,
  qcontact_ticket_id VARCHAR(100),

  -- Sync details
  sync_direction VARCHAR(10) NOT NULL,
  sync_type VARCHAR(30) NOT NULL,

  -- Payload
  request_payload JSONB,
  response_payload JSONB,

  -- Result
  status VARCHAR(20) NOT NULL,
  error_message TEXT,

  synced_at TIMESTAMP DEFAULT NOW(),

  CHECK (sync_direction IN ('inbound', 'outbound')),
  CHECK (sync_type IN ('create', 'status_update', 'assignment', 'note_add', 'full_sync')),
  CHECK (status IN ('success', 'failed', 'partial'))
);

COMMENT ON TABLE qcontact_sync_log IS 'Audit log for bidirectional synchronization with QContact system';
COMMENT ON COLUMN qcontact_sync_log.sync_direction IS 'inbound = QContact to FibreFlow, outbound = FibreFlow to QContact';
COMMENT ON COLUMN qcontact_sync_log.sync_type IS 'Type of sync operation: create, status_update, assignment, note_add, full_sync';

-- 5. guarantee_periods - Guarantee configuration by project
CREATE TABLE IF NOT EXISTS guarantee_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,

  -- Guarantee rules
  installation_guarantee_days INTEGER DEFAULT 90,
  material_guarantee_days INTEGER DEFAULT 365,

  -- Billing rules
  contractor_liable_during_guarantee BOOLEAN DEFAULT true,
  auto_classify_out_of_guarantee BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(project_id)
);

COMMENT ON TABLE guarantee_periods IS 'Project-specific guarantee periods and billing rules';
COMMENT ON COLUMN guarantee_periods.installation_guarantee_days IS 'Installation work guarantee period (default 90 days)';
COMMENT ON COLUMN guarantee_periods.material_guarantee_days IS 'Material/equipment guarantee period (default 365 days)';
COMMENT ON COLUMN guarantee_periods.contractor_liable_during_guarantee IS 'Whether contractor is liable for repairs during guarantee period';

-- 6. whatsapp_notifications - Notification delivery tracking
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID,

  -- Recipient
  recipient_type VARCHAR(20) NOT NULL,
  recipient_phone VARCHAR(20),
  recipient_name VARCHAR(255),

  -- Message
  message_template VARCHAR(100),
  message_content TEXT,

  -- Delivery
  status VARCHAR(20) DEFAULT 'pending',
  waha_message_id VARCHAR(100),
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  error_message TEXT,

  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (recipient_type IN ('contractor', 'technician', 'client', 'team')),
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed'))
);

COMMENT ON TABLE whatsapp_notifications IS 'WhatsApp notification delivery tracking via WAHA API';
COMMENT ON COLUMN whatsapp_notifications.recipient_type IS 'Type of recipient: contractor, technician, client, team';
COMMENT ON COLUMN whatsapp_notifications.waha_message_id IS 'Message ID from WAHA WhatsApp API';

-- 7. ticket_attachments - File metadata
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,

  -- File info
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50), -- 'photo', 'document', 'excel', 'pdf'
  mime_type VARCHAR(100),
  file_size INTEGER,

  -- Storage
  storage_path TEXT NOT NULL, -- Firebase Storage path
  storage_url TEXT, -- Public URL

  -- Metadata
  uploaded_by UUID,
  uploaded_at TIMESTAMP DEFAULT NOW(),

  -- For photo evidence
  verification_step_id UUID,
  is_evidence BOOLEAN DEFAULT false
);

COMMENT ON TABLE ticket_attachments IS 'File attachments (photos, documents) linked to tickets';
COMMENT ON COLUMN ticket_attachments.storage_path IS 'Firebase Storage path to the file';
COMMENT ON COLUMN ticket_attachments.verification_step_id IS 'Links photo to specific verification step if used as evidence';
COMMENT ON COLUMN ticket_attachments.is_evidence IS 'Indicates if attachment is used as verification evidence';

-- 8. ticket_notes - Internal/client notes
CREATE TABLE IF NOT EXISTS ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,

  -- Note content
  note_type VARCHAR(20) DEFAULT 'internal',
  content TEXT NOT NULL,

  -- Author
  created_by UUID,
  created_at TIMESTAMP DEFAULT NOW(),

  -- For system-generated notes
  system_event VARCHAR(50), -- 'status_change', 'assignment', 'sla_warning', etc.
  event_data JSONB,

  CHECK (note_type IN ('internal', 'client', 'system'))
);

COMMENT ON TABLE ticket_notes IS 'Notes and comments associated with tickets (internal, client-facing, or system-generated)';
COMMENT ON COLUMN ticket_notes.note_type IS 'Type of note: internal (staff only), client (visible to client), system (auto-generated)';
COMMENT ON COLUMN ticket_notes.system_event IS 'Event type for system-generated notes (status_change, assignment, sla_warning, etc.)';

-- Create updated_at trigger function (reusable)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to tickets table
CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply updated_at trigger to guarantee_periods table
CREATE TRIGGER update_guarantee_periods_updated_at BEFORE UPDATE ON guarantee_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
