-- Migration 179: PON Stage Tracking
-- Tracks per-PON build pipeline progress: Permissions → Poles → CWC → Optical → ATP → Activation
-- Data sourced from 1Map API sync + OES activations

-- ============================================================================
-- 1. PON STAGE TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pon_stage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    zone_no INTEGER NOT NULL,
    pon_no INTEGER NOT NULL,

    -- Stage: Permissions (from 1Map status "Pole Permission: Approved")
    permissions_total INTEGER DEFAULT 0,
    permissions_approved INTEGER DEFAULT 0,
    permissions_first_date DATE,
    permissions_last_date DATE,

    -- Stage: Poles Planted (from 1Map pole data / QField)
    poles_total INTEGER DEFAULT 0,
    poles_planted INTEGER DEFAULT 0,
    poles_first_date DATE,
    poles_last_date DATE,

    -- Stage: CWC - Civil Works Complete (from 1Map civil_dte)
    cwc_total INTEGER DEFAULT 0,
    cwc_complete INTEGER DEFAULT 0,
    cwc_first_date DATE,
    cwc_last_date DATE,

    -- Stage: Optical / Splicing (from 1Map home sign-up status)
    optical_total INTEGER DEFAULT 0,
    optical_complete INTEGER DEFAULT 0,
    optical_first_date DATE,
    optical_last_date DATE,

    -- Stage: ATP - Acceptance Test Passed
    atp_total INTEGER DEFAULT 0,
    atp_passed INTEGER DEFAULT 0,
    atp_first_date DATE,
    atp_last_date DATE,

    -- Stage: Activation (from oes_activations)
    activation_total INTEGER DEFAULT 0,
    activation_complete INTEGER DEFAULT 0,
    activation_first_date DATE,
    activation_last_date DATE,

    -- Overall stage = latest stage that is 100% complete
    overall_stage VARCHAR(30) DEFAULT 'not_started' CHECK (overall_stage IN (
        'not_started', 'permissions', 'poles', 'cwc', 'optical', 'atp', 'activation', 'complete'
    )),

    -- Sync tracking
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    sync_source VARCHAR(20) DEFAULT '1map',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(project_id, zone_no, pon_no)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pon_stage_project ON pon_stage_tracking(project_id);
CREATE INDEX IF NOT EXISTS idx_pon_stage_zone ON pon_stage_tracking(project_id, zone_no);
CREATE INDEX IF NOT EXISTS idx_pon_stage_overall ON pon_stage_tracking(project_id, overall_stage);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================================

CREATE TRIGGER pon_stage_tracking_updated_at
    BEFORE UPDATE ON pon_stage_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. COMMENTS
-- ============================================================================

COMMENT ON TABLE pon_stage_tracking IS 'Per-PON build pipeline progress tracking. Synced from 1Map API + OES activations. Stages: Permissions → Poles → CWC → Optical → ATP → Activation';
COMMENT ON COLUMN pon_stage_tracking.overall_stage IS 'Latest stage that is 100% complete for this PON';
COMMENT ON COLUMN pon_stage_tracking.sync_source IS 'Source of last sync: 1map, oes, manual';
