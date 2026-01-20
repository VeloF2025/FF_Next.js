-- Migration: 095_qa_wizard_draft_state.sql
-- Purpose: Add draft state support for QA Wizard Phase 4 (Final Decision)
-- Date: 2026-01-20
--
-- This enables saving work-in-progress state when navigating back,
-- preventing data loss if user leaves the phase before submitting.

-- Add draft flag for Phase 4
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_decision_is_draft BOOLEAN DEFAULT FALSE;

-- Add separate fields for internal notes vs technician feedback
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_internal_notes TEXT;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_technician_feedback TEXT;

-- Add issue classification JSONB for structured issue tracking
-- Structure: { issueType, correctValue, createTicket, ticketType, ticketDescription }
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_issue_classification JSONB DEFAULT '{}';

-- Also add to dr_photo_unified_reviews for consistency
ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS qa_decision_is_draft BOOLEAN DEFAULT FALSE;
ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS qa_internal_notes TEXT;
ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS qa_technician_feedback TEXT;
ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS qa_issue_classification JSONB DEFAULT '{}';

-- Add comments (wrapped in DO block to handle missing columns gracefully)
DO $$
BEGIN
  COMMENT ON COLUMN foto_ai_reviews.qa_decision_is_draft IS 'True if decision is a draft (not finalized), allows resuming Phase 4';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  COMMENT ON COLUMN foto_ai_reviews.qa_internal_notes IS 'Internal QA team notes (not sent to technician)';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  COMMENT ON COLUMN foto_ai_reviews.qa_technician_feedback IS 'Feedback message to send via WhatsApp';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  COMMENT ON COLUMN foto_ai_reviews.qa_issue_classification IS 'Structured issue classification: {issueType, correctValue, createTicket, ticketType, ticketDescription}';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
