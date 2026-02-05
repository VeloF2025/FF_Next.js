-- Migration 161: WhatsApp Contacts Table
-- Created: 2026-02-05
-- Purpose: Map WhatsApp phone numbers to formal staff names for reporting

-- ============================================
-- WhatsApp Contacts Table
-- ============================================

CREATE TABLE IF NOT EXISTS wa_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WhatsApp identification
  sender_phone VARCHAR(50) NOT NULL UNIQUE,  -- e.g., "27871234567"
  wa_display_name VARCHAR(100),              -- Name from WhatsApp (auto-captured)

  -- Formal identity
  formal_name VARCHAR(100),                  -- Official name for reports
  employee_id VARCHAR(50),                   -- Link to HR/payroll if applicable

  -- Assignment
  team VARCHAR(50),                          -- Team name (e.g., "Team Alpha")
  role VARCHAR(50) DEFAULT 'activator',      -- activator, installer, supervisor
  projects TEXT[],                           -- Array of project names they work on

  -- Optional staff link
  staff_id UUID REFERENCES staff(id),        -- Link to staff table if employee

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(100),
  updated_by VARCHAR(100)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wa_contacts_phone ON wa_contacts(sender_phone);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_team ON wa_contacts(team);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_staff_id ON wa_contacts(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_contacts_active ON wa_contacts(is_active) WHERE is_active = true;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_wa_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_wa_contacts_updated_at ON wa_contacts;
CREATE TRIGGER update_wa_contacts_updated_at
    BEFORE UPDATE ON wa_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_wa_contacts_updated_at();

-- ============================================
-- Seed from existing qa_photo_reviews data
-- ============================================

-- Auto-populate from unique sender_phone/user_name combinations
INSERT INTO wa_contacts (sender_phone, wa_display_name, projects, created_by)
SELECT
  sender_phone,
  MAX(user_name) as wa_display_name,
  ARRAY_AGG(DISTINCT project) FILTER (WHERE project IS NOT NULL) as projects,
  'migration' as created_by
FROM qa_photo_reviews
WHERE sender_phone IS NOT NULL
  AND sender_phone != ''
GROUP BY sender_phone
ON CONFLICT (sender_phone) DO NOTHING;

-- Comment
COMMENT ON TABLE wa_contacts IS 'Maps WhatsApp phone numbers to formal staff names for reporting and recognition';
COMMENT ON COLUMN wa_contacts.role IS 'activator = submits QA photos via WhatsApp, installer = from OES/1Map team, supervisor = team lead';
