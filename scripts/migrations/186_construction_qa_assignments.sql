-- Migration: 186_construction_qa_assignments.sql
-- Description: Assignment tracking table and v_construction_qa_reviews view
--              for the Construction QA module.
--              Assignments log the full history of who was assigned what,
--              when, and at what priority.  The view joins reviews with live
--              feature data from poles, cable_spans, and joints.
-- Date: 2026-02-18
-- Depends on: 183_construction_qa_reviews.sql, 184_construction_qa_photos.sql

-- ============================================================================
-- construction_qa_assignments
-- Historical record of every assignment made against a review.
-- The current assignment is also denormalized onto construction_qa_reviews
-- (assigned_to, assigned_at, assigned_by, due_date, priority) for fast reads.
-- ============================================================================

CREATE TABLE IF NOT EXISTS construction_qa_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id    UUID NOT NULL REFERENCES construction_qa_reviews(id) ON DELETE CASCADE,
    assigned_to  TEXT NOT NULL,
    assigned_by  TEXT NOT NULL,
    assigned_at  TIMESTAMPTZ DEFAULT NOW(),
    due_date     TIMESTAMPTZ,
    priority     TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    notes        TEXT,
    completed_at TIMESTAMPTZ,

    -- Duplicate constraint kept explicit per PRD spec
    CONSTRAINT cqa_assignment_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

COMMENT ON TABLE construction_qa_assignments IS 'Full assignment history for construction QA reviews. Each row represents one assignment event; the active assignment is also denormalized onto construction_qa_reviews for query performance.';
COMMENT ON COLUMN construction_qa_assignments.assigned_to IS 'Identifier (user ID or username) of the QA team member the review is assigned to';
COMMENT ON COLUMN construction_qa_assignments.assigned_by IS 'Identifier of the user or system actor that created the assignment';
COMMENT ON COLUMN construction_qa_assignments.completed_at IS 'Timestamp when the assignee completed (or closed) the review; NULL while open';

-- ============================================================================
-- Index
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cqa_assignments_review
    ON construction_qa_assignments(review_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_cqa_assignments_assignee
    ON construction_qa_assignments(assigned_to, completed_at)
    WHERE completed_at IS NULL;

-- ============================================================================
-- v_construction_qa_reviews
-- Read-optimised view joining reviews with live feature context from poles,
-- cable_spans, and joints.  Also computes approved_photo_count and
-- pending_retake_count as subquery aggregates.
--
-- Pole column mapping (actual poles table columns):
--   pole_type       -> pole_type_live
--   height_meters   -> pole_height_live
--   material        -> pole_material_live
--   status          -> pole_status_live
--   latitude        -> pole_lat_live
--   longitude       -> pole_lon_live
-- ============================================================================

CREATE OR REPLACE VIEW v_construction_qa_reviews AS
SELECT
    r.*,
    p.project_name AS project_name,
    p.client_id    AS client_id,

    -- Pole context (populated when feature_type = 'pole')
    po.pole_type       AS pole_type_live,
    po.height          AS pole_height_live,
    po.material        AS pole_material_live,
    po.status          AS pole_status_live,
    po.latitude        AS pole_lat_live,
    po.longitude       AS pole_lon_live,

    -- Cable span context (populated when feature_type = 'cable_span')
    cs.span_type       AS span_type_live,
    cs.cable_size      AS cable_size_live,
    cs.length_meters   AS span_length_live,

    -- Joint context (populated when feature_type = 'joint')
    j.joint_type       AS joint_type_live,
    j.cable_capacity   AS joint_cable_cap_live,

    -- Computed: number of individually approved photos for this review
    (
        SELECT COUNT(*)
        FROM construction_qa_photos ph
        WHERE ph.review_id = r.id
          AND ph.manual_status = 'approved'
    ) AS approved_photo_count,

    -- Computed: number of photos awaiting retake (notified but not yet replaced)
    (
        SELECT COUNT(*)
        FROM construction_qa_photos ph
        WHERE ph.review_id = r.id
          AND ph.needs_retake = TRUE
          AND ph.retake_completed_at IS NULL
    ) AS pending_retake_count

FROM construction_qa_reviews r
JOIN  projects    p  ON p.id  = r.project_id
LEFT JOIN poles   po ON r.feature_type = 'pole'
                     AND po.pole_number = r.feature_id
                     AND po.project_id = r.project_id
LEFT JOIN cable_spans cs ON r.feature_type = 'cable_span'
                         AND cs.span_label = r.feature_id
                         AND cs.project_id = r.project_id
LEFT JOIN joints  j  ON r.feature_type = 'joint'
                     AND j.joint_label  = r.feature_id
                     AND j.project_id   = r.project_id;

COMMENT ON VIEW v_construction_qa_reviews IS 'Read-optimised view over construction_qa_reviews enriched with live feature data from poles, cable_spans, and joints, plus computed photo counts. Use this view for all list/detail reads in the Construction QA UI.';
