-- Migration: 183_construction_qa_reviews.sql
-- Description: Core review table for the Construction QA module — single source of truth
--              for all construction QA review state (analogous to dr_photo_unified_reviews
--              in the Activate module).
-- Date: 2026-02-18

-- ============================================================================
-- construction_qa_reviews
-- One row per feature (pole / cable span / joint) per project.
-- Tracks photo state, VLM results, checklist steps, and QA workflow status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS construction_qa_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Feature identification (what is being QA'd)
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    discipline    TEXT NOT NULL CHECK (discipline IN ('civil', 'optical', 'splicing')),
    feature_type  TEXT NOT NULL CHECK (feature_type IN ('pole', 'cable_span', 'joint')),
    feature_id    TEXT NOT NULL,       -- pole_number, span_label, or joint_label
    zone_no       INTEGER,
    pon_no        INTEGER,

    -- Photo state
    photo_count         INTEGER DEFAULT 0,
    photos_json         JSONB DEFAULT '[]',   -- Array of {url, source, step, filename, size, captured_at}
    photo_sources       TEXT[] DEFAULT '{}',  -- ['qfield', 'sharepoint', 'whatsapp', 'upload']
    last_photo_at       TIMESTAMPTZ,

    -- -----------------------------------------------------------------------
    -- Checklist steps: boolean flags per discipline
    -- -----------------------------------------------------------------------

    -- Civil (pole planting) — 7 steps
    civil_step_01_foundation    BOOLEAN DEFAULT FALSE,
    civil_step_02_full_pole     BOOLEAN DEFAULT FALSE,
    civil_step_03_pole_label    BOOLEAN DEFAULT FALSE,
    civil_step_04_cca_tag       BOOLEAN DEFAULT FALSE,
    civil_step_05_vertical      BOOLEAN DEFAULT FALSE,
    civil_step_06_guy_wires     BOOLEAN DEFAULT FALSE,
    civil_step_07_slack_bracket BOOLEAN DEFAULT FALSE,

    -- Optical (cable stringing) — 6 steps
    optical_step_01_cable_route     BOOLEAN DEFAULT FALSE,
    optical_step_02_attachment      BOOLEAN DEFAULT FALSE,
    optical_step_03_slack_coil      BOOLEAN DEFAULT FALSE,
    optical_step_04_cable_label     BOOLEAN DEFAULT FALSE,
    optical_step_05_no_backfeed     BOOLEAN DEFAULT FALSE,
    optical_step_06_sag_ok          BOOLEAN DEFAULT FALSE,

    -- Splicing (dome joints) — 7 steps
    splicing_step_01_dome_closed    BOOLEAN DEFAULT FALSE,
    splicing_step_02_slack_bracket  BOOLEAN DEFAULT FALSE,
    splicing_step_03_emergency_loop BOOLEAN DEFAULT FALSE,
    splicing_step_04_backhaul_sep   BOOLEAN DEFAULT FALSE,
    splicing_step_05_tray_org       BOOLEAN DEFAULT FALSE,
    splicing_step_06_heat_shrinks   BOOLEAN DEFAULT FALSE,
    splicing_step_07_dome_label     BOOLEAN DEFAULT FALSE,

    -- -----------------------------------------------------------------------
    -- VLM processing
    -- -----------------------------------------------------------------------
    vlm_status           TEXT DEFAULT 'pending' CHECK (vlm_status IN ('pending', 'processing', 'completed', 'failed')),
    vlm_confidence       NUMERIC(3,2),              -- 0.00 to 1.00 overall score
    vlm_step_scores      JSONB DEFAULT '{}',        -- {step_01: 0.91, step_02: 0.55, ...}
    vlm_issues           TEXT[] DEFAULT '{}',       -- Human-readable issue list
    vlm_feedback         TEXT,                      -- Detailed feedback text
    vlm_raw_response     JSONB,                     -- Full VLM JSON response
    vlm_processed_at     TIMESTAMPTZ,
    vlm_model_version    TEXT,                      -- Model/prompt version used
    vlm_retry_count      INTEGER DEFAULT 0,

    -- -----------------------------------------------------------------------
    -- Extracted data (populated by VLM or manually)
    -- -----------------------------------------------------------------------
    extracted_pole_number    TEXT,    -- VLM read from pole label photo
    extracted_pole_height    TEXT,    -- VLM estimated from context
    extracted_cable_type     TEXT,    -- VLM read from cable label
    extracted_joint_type     TEXT,    -- VLM identified (dome type)
    extracted_splice_count   INTEGER, -- VLM counted splice trays
    extracted_notes          JSONB DEFAULT '{}',    -- Freeform VLM observations

    -- -----------------------------------------------------------------------
    -- QA Workflow
    -- -----------------------------------------------------------------------
    workflow_status     TEXT DEFAULT 'pending' CHECK (
        workflow_status IN ('pending', 'in_review', 'approved', 'rejected', 'rework_needed', 'escalated')
    ),
    manual_status       TEXT CHECK (manual_status IN ('approved', 'rejected', 'rework_needed', NULL)),
    qa_decision         TEXT CHECK (qa_decision IN ('PASS', 'FAIL', 'REWORK_NEEDED', NULL)),
    qa_decision_at      TIMESTAMPTZ,
    qa_decision_by      TEXT,                      -- User who made the decision
    qa_reason_code      TEXT,                      -- Standardised reason code
    qa_notes            TEXT,                      -- Free-text reviewer notes
    rework_count        INTEGER DEFAULT 0,         -- Number of times sent back for rework

    -- -----------------------------------------------------------------------
    -- Assignment
    -- -----------------------------------------------------------------------
    assigned_to     TEXT,
    assigned_at     TIMESTAMPTZ,
    assigned_by     TEXT,
    due_date        TIMESTAMPTZ,
    priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

    -- -----------------------------------------------------------------------
    -- Escalation
    -- -----------------------------------------------------------------------
    escalation_level    INTEGER DEFAULT 0,
    escalated_at        TIMESTAMPTZ,
    escalation_reason   TEXT,

    -- -----------------------------------------------------------------------
    -- WhatsApp feedback
    -- -----------------------------------------------------------------------
    wa_feedback_sent_at  TIMESTAMPTZ,
    wa_feedback_message  TEXT,
    wa_group_jid         TEXT,
    wa_technician_phone  TEXT,

    -- -----------------------------------------------------------------------
    -- Submission tracking (supports resubmissions)
    -- -----------------------------------------------------------------------
    submission_count        INTEGER DEFAULT 1,
    first_submitted_at      TIMESTAMPTZ,
    last_submitted_at       TIMESTAMPTZ,
    resubmission_snapshots  JSONB DEFAULT '[]',    -- Array of previous submission states

    -- -----------------------------------------------------------------------
    -- Denormalized feature data (for performance — avoids joins on read)
    -- -----------------------------------------------------------------------
    pole_latitude     NUMERIC,
    pole_longitude    NUMERIC,
    pole_material     TEXT,
    pole_height_m     NUMERIC,
    span_from_pole    TEXT,
    span_to_pole      TEXT,
    span_length_m     NUMERIC,
    span_cable_size   TEXT,
    joint_cable_cap   TEXT,

    -- -----------------------------------------------------------------------
    -- Metadata
    -- -----------------------------------------------------------------------
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(project_id, feature_type, feature_id)
);

COMMENT ON TABLE construction_qa_reviews IS 'Single source of truth for all construction QA review state. One row per (project, feature_type, feature_id) triple. Analogous to dr_photo_unified_reviews in the Activate module.';
COMMENT ON COLUMN construction_qa_reviews.discipline IS 'QA discipline: civil (pole planting), optical (cable stringing), splicing (dome joints)';
COMMENT ON COLUMN construction_qa_reviews.feature_type IS 'Type of network feature being reviewed: pole, cable_span, or joint';
COMMENT ON COLUMN construction_qa_reviews.feature_id IS 'Natural identifier for the feature: pole_number, span_label, or joint_label';
COMMENT ON COLUMN construction_qa_reviews.photos_json IS 'Denormalized snapshot of photo list: [{url, source, step, filename, size, captured_at}]';
COMMENT ON COLUMN construction_qa_reviews.vlm_step_scores IS 'Per-step confidence scores from VLM: {step_01: 0.91, step_02: 0.55, ...}';
COMMENT ON COLUMN construction_qa_reviews.vlm_retry_count IS 'Number of times VLM processing has been retried after failure';
COMMENT ON COLUMN construction_qa_reviews.resubmission_snapshots IS 'JSONB array of previous submission state snapshots for audit/history';
COMMENT ON COLUMN construction_qa_reviews.rework_count IS 'Number of times this review has been sent back for rework';
COMMENT ON COLUMN construction_qa_reviews.qa_reason_code IS 'Standardised reject/rework reason code (see PRD Section 7)';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cqa_project_discipline
    ON construction_qa_reviews(project_id, discipline);

CREATE INDEX IF NOT EXISTS idx_cqa_zone_pon
    ON construction_qa_reviews(zone_no, pon_no);

CREATE INDEX IF NOT EXISTS idx_cqa_workflow_status
    ON construction_qa_reviews(workflow_status, assigned_to);

CREATE INDEX IF NOT EXISTS idx_cqa_vlm_status
    ON construction_qa_reviews(vlm_status) WHERE vlm_status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_cqa_feature
    ON construction_qa_reviews(feature_type, feature_id);

CREATE INDEX IF NOT EXISTS idx_cqa_priority
    ON construction_qa_reviews(priority, workflow_status);
