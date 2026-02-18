-- Migration: 185_construction_qa_activity.sql
-- Description: Activity / audit log table for the Construction QA module.
--              Immutable event log for all state transitions, decisions,
--              assignments, VLM results, and feedback actions on a review.
-- Date: 2026-02-18
-- Depends on: 183_construction_qa_reviews.sql, 184_construction_qa_photos.sql

-- ============================================================================
-- construction_qa_activity
-- One row per auditable event on a review or photo.
-- Actors can be human users, the system, or the VLM.
-- ============================================================================

CREATE TABLE IF NOT EXISTS construction_qa_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id    UUID NOT NULL REFERENCES construction_qa_reviews(id) ON DELETE CASCADE,
    photo_id     UUID REFERENCES construction_qa_photos(id),

    -- -----------------------------------------------------------------------
    -- Event classification
    -- Permitted values:
    --   photo_ingested       — a new photo was received and stored
    --   vlm_started          — VLM processing queued / begun
    --   vlm_completed        — VLM analysis returned results
    --   vlm_failed           — VLM processing errored
    --   review_opened        — QA reviewer opened the review
    --   step_checked         — reviewer manually ticked a checklist step
    --   step_unchecked       — reviewer manually unticked a checklist step
    --   decision_made        — QA decision recorded (PASS / FAIL / REWORK_NEEDED)
    --   feedback_sent        — WhatsApp feedback message dispatched
    --   rework_requested     — review sent back to technician for rework
    --   resubmission_received — technician submitted corrected photos
    --   assigned             — review assigned to a QA team member
    --   escalated            — review escalated to senior QA / manager
    --   comment_added        — free-text note added to the review
    -- -----------------------------------------------------------------------
    event_type   TEXT NOT NULL,

    actor        TEXT,         -- User ID, 'system', or 'vlm'
    actor_name   TEXT,         -- Human-readable name for display
    payload      JSONB DEFAULT '{}',  -- Event-specific structured data
    notes        TEXT,                -- Optional free-text context

    created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE construction_qa_activity IS 'Immutable activity / audit log for construction QA reviews. Records all state transitions, decisions, assignments, and VLM events.';
COMMENT ON COLUMN construction_qa_activity.event_type IS 'Event type — see migration comment for full enumeration of valid values';
COMMENT ON COLUMN construction_qa_activity.actor IS 'Who triggered the event: a user ID string, ''system'' (automated), or ''vlm''';
COMMENT ON COLUMN construction_qa_activity.payload IS 'Event-specific structured data, e.g. {step: 3, old_value: false, new_value: true} for step_checked';
COMMENT ON COLUMN construction_qa_activity.photo_id IS 'Optional FK to a specific photo when the event concerns a single photo (e.g. vlm_completed, photo_ingested)';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cqa_activity_review
    ON construction_qa_activity(review_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cqa_activity_type
    ON construction_qa_activity(event_type, created_at DESC);
