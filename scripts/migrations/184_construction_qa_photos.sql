-- Migration: 184_construction_qa_photos.sql
-- Description: Individual photo metadata table for Construction QA module.
--              Stores per-photo VLM results, manual review status, and retake
--              tracking. Supports per-photo approve/reject workflow.
-- Date: 2026-02-18
-- Depends on: 183_construction_qa_reviews.sql

-- ============================================================================
-- construction_qa_photos
-- One row per photo submitted for a construction QA review.
-- Allows individual photo approval, VLM scoring, and retake management.
-- ============================================================================

CREATE TABLE IF NOT EXISTS construction_qa_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id  UUID NOT NULL REFERENCES construction_qa_reviews(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- -----------------------------------------------------------------------
    -- Storage reference
    -- -----------------------------------------------------------------------
    source       TEXT NOT NULL CHECK (source IN ('qfield', 'sharepoint', 'whatsapp', 'upload')),
    storage_key  TEXT NOT NULL,    -- MinIO path, SharePoint item ID, Firebase path, or WA message ID
    storage_url  TEXT,             -- Resolved URL (may expire; regenerate via proxy)
    filename     TEXT,
    file_size_bytes BIGINT,
    mime_type    TEXT DEFAULT 'image/jpeg',

    -- -----------------------------------------------------------------------
    -- Checklist assignment
    -- -----------------------------------------------------------------------
    checklist_step  INTEGER,       -- 1-7 (civil), 1-6 (optical), 1-7 (splicing), NULL if uncategorised
    step_label      TEXT,

    -- -----------------------------------------------------------------------
    -- VLM per-photo results
    -- -----------------------------------------------------------------------
    vlm_valid        BOOLEAN,
    vlm_confidence   NUMERIC(3,2),
    vlm_issues       TEXT[] DEFAULT '{}',
    vlm_feedback     TEXT,
    vlm_raw          JSONB,
    vlm_processed_at TIMESTAMPTZ,

    -- -----------------------------------------------------------------------
    -- Manual review
    -- -----------------------------------------------------------------------
    manual_status       TEXT CHECK (manual_status IN ('approved', 'rejected', 'pending', NULL)),
    manual_reviewed_by  TEXT,
    manual_reviewed_at  TIMESTAMPTZ,
    manual_notes        TEXT,

    -- -----------------------------------------------------------------------
    -- Retake tracking
    -- -----------------------------------------------------------------------
    needs_retake        BOOLEAN DEFAULT FALSE,
    retake_notified_at  TIMESTAMPTZ,
    retake_completed_at TIMESTAMPTZ,
    retake_for_photo_id UUID REFERENCES construction_qa_photos(id),

    -- -----------------------------------------------------------------------
    -- Capture metadata (EXIF / device-provided)
    -- -----------------------------------------------------------------------
    captured_at   TIMESTAMPTZ,    -- EXIF timestamp if available
    gps_lat       NUMERIC,        -- EXIF GPS latitude if available
    gps_lon       NUMERIC,        -- EXIF GPS longitude if available
    captured_by   TEXT,           -- Technician identifier (phone number or QField username)

    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE construction_qa_photos IS 'Individual photo records for construction QA reviews. Supports per-photo VLM scoring, manual approval, and retake management.';
COMMENT ON COLUMN construction_qa_photos.source IS 'Origin of the photo: qfield, sharepoint, whatsapp, or upload';
COMMENT ON COLUMN construction_qa_photos.storage_key IS 'Primary storage reference: MinIO path, SharePoint item ID, Firebase path, or WA message ID';
COMMENT ON COLUMN construction_qa_photos.storage_url IS 'Resolved public/signed URL — may expire; regenerate via storage proxy';
COMMENT ON COLUMN construction_qa_photos.checklist_step IS 'Checklist step this photo covers: 1-7 (civil), 1-6 (optical), 1-7 (splicing), or NULL if uncategorised';
COMMENT ON COLUMN construction_qa_photos.vlm_valid IS 'Whether VLM judged this photo as valid evidence for its checklist step';
COMMENT ON COLUMN construction_qa_photos.vlm_confidence IS 'VLM confidence score 0.00–1.00 for this individual photo';
COMMENT ON COLUMN construction_qa_photos.retake_for_photo_id IS 'Self-referential FK: when this photo is a retake, points to the original rejected photo';
COMMENT ON COLUMN construction_qa_photos.captured_by IS 'Technician identifier: WhatsApp phone number or QField username';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cqa_photos_review
    ON construction_qa_photos(review_id);

CREATE INDEX IF NOT EXISTS idx_cqa_photos_source
    ON construction_qa_photos(source, project_id);

CREATE INDEX IF NOT EXISTS idx_cqa_photos_step
    ON construction_qa_photos(review_id, checklist_step);

CREATE INDEX IF NOT EXISTS idx_cqa_photos_retake
    ON construction_qa_photos(needs_retake, retake_notified_at)
    WHERE needs_retake = TRUE;
