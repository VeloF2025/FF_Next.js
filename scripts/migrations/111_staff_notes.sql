-- Migration 111: Staff Notes Table
-- Created: January 2026
-- Purpose: Store notes, comments, and generated summaries for staff members

-- Create staff_notes table
CREATE TABLE IF NOT EXISTS staff_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  note_type VARCHAR(50) NOT NULL DEFAULT 'general',
  title VARCHAR(255),
  content TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_by_name VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_staff_notes_staff_id ON staff_notes(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_notes_note_type ON staff_notes(note_type);
CREATE INDEX IF NOT EXISTS idx_staff_notes_created_at ON staff_notes(created_at DESC);

-- Add comment
COMMENT ON TABLE staff_notes IS 'Notes, comments, and generated summaries for staff members';
COMMENT ON COLUMN staff_notes.note_type IS 'Type: general, contract_summary, hr_note, document_note, system';
COMMENT ON COLUMN staff_notes.metadata IS 'Additional data like contract metadata used for summary generation';

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_staff_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_staff_notes_updated_at ON staff_notes;
CREATE TRIGGER trigger_staff_notes_updated_at
  BEFORE UPDATE ON staff_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_staff_notes_updated_at();
