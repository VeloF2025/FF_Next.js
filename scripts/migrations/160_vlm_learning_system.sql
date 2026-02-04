-- Migration: 160_vlm_learning_system.sql
-- Purpose: Enterprise-wide VLM learning system using HITL corrections for few-shot prompting
-- Created: 2026-02-04

-- ============================================================================
-- TABLE: vlm_corrections - Universal Corrections Table
-- Records all HITL corrections across modules for few-shot learning
-- ============================================================================

CREATE TABLE IF NOT EXISTS vlm_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Module & Type Classification
    module VARCHAR(50) NOT NULL,            -- 'activate', 'fleet', 'procurement', 'assets', 'staff'
    analysis_type VARCHAR(100) NOT NULL,    -- 'odometer', 'ont_serial', 'power_meter', 'quote_line_item', etc.

    -- Source Reference (link back to original record)
    source_id UUID,
    source_table VARCHAR(100),
    photo_url TEXT,

    -- VLM Output (what the model extracted)
    vlm_extracted_value TEXT,
    vlm_confidence NUMERIC(3,2),
    vlm_model VARCHAR(100),
    vlm_prompt_hash VARCHAR(64),            -- Track which prompt version was used

    -- Human Correction (the ground truth)
    corrected_value TEXT NOT NULL,
    correction_reason VARCHAR(100),         -- 'digit_confusion', 'wrong_field', 'partial_extraction', 'format_error'
    error_pattern VARCHAR(50),              -- 'digit_1_6', 'missed_decimal', 'wrong_serial_format'
    correction_notes TEXT,

    -- Context (module-specific, for few-shot matching)
    context_json JSONB DEFAULT '{}'::jsonb, -- {vehicleMake, dashboardType, documentType, etc.}

    -- Quality & Curation
    is_canonical BOOLEAN DEFAULT false,     -- Curated high-quality examples
    priority INTEGER DEFAULT 0,             -- Higher = used first in few-shot (0-100)
    reviewed_by UUID REFERENCES staff(id),
    corrected_by_name VARCHAR(100),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_vlm_corrections_module ON vlm_corrections(module, analysis_type);
CREATE INDEX IF NOT EXISTS idx_vlm_corrections_pattern ON vlm_corrections(error_pattern) WHERE error_pattern IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vlm_corrections_canonical ON vlm_corrections(is_canonical, priority DESC) WHERE is_canonical = true;
CREATE INDEX IF NOT EXISTS idx_vlm_corrections_recent ON vlm_corrections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vlm_corrections_source ON vlm_corrections(source_table, source_id) WHERE source_id IS NOT NULL;

-- ============================================================================
-- TABLE: vlm_metrics - Accuracy Tracking (aggregated daily)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vlm_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_date DATE NOT NULL,
    module VARCHAR(50) NOT NULL,
    analysis_type VARCHAR(100) NOT NULL,

    -- Counts
    total_extractions INTEGER DEFAULT 0,
    correct_extractions INTEGER DEFAULT 0,
    corrected_extractions INTEGER DEFAULT 0,
    failed_extractions INTEGER DEFAULT 0,

    -- Calculated metrics
    accuracy_rate NUMERIC(5,4),
    avg_confidence NUMERIC(3,2),

    -- Error breakdown (for analysis)
    digit_confusion_count INTEGER DEFAULT 0,
    format_error_count INTEGER DEFAULT 0,
    partial_extraction_count INTEGER DEFAULT 0,
    field_confusion_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint for upserts
    UNIQUE (metric_date, module, analysis_type)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_vlm_metrics_date ON vlm_metrics(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_vlm_metrics_module ON vlm_metrics(module, analysis_type);

-- ============================================================================
-- TABLE: vlm_prompt_versions - Track prompt versions for A/B testing
-- ============================================================================

CREATE TABLE IF NOT EXISTS vlm_prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module VARCHAR(50) NOT NULL,
    analysis_type VARCHAR(100) NOT NULL,

    version_name VARCHAR(100) NOT NULL,
    prompt_hash VARCHAR(64) NOT NULL,       -- SHA-256 of prompt content
    prompt_content TEXT NOT NULL,           -- Full prompt text

    is_active BOOLEAN DEFAULT false,        -- Currently in use
    is_baseline BOOLEAN DEFAULT false,      -- Original/baseline prompt

    -- Performance tracking
    total_uses INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    accuracy_rate NUMERIC(5,4),

    -- Metadata
    created_by_name VARCHAR(100),
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (module, analysis_type, prompt_hash)
);

CREATE INDEX IF NOT EXISTS idx_vlm_prompt_versions_active ON vlm_prompt_versions(module, analysis_type) WHERE is_active = true;

-- ============================================================================
-- FUNCTION: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_vlm_corrections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_vlm_corrections_updated_at
    BEFORE UPDATE ON vlm_corrections
    FOR EACH ROW
    EXECUTE FUNCTION update_vlm_corrections_updated_at();

CREATE TRIGGER trigger_vlm_metrics_updated_at
    BEFORE UPDATE ON vlm_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_vlm_corrections_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE vlm_corrections IS 'Stores HITL corrections for VLM extractions across all modules - used for few-shot learning';
COMMENT ON TABLE vlm_metrics IS 'Daily aggregated metrics for VLM accuracy tracking per module/analysis_type';
COMMENT ON TABLE vlm_prompt_versions IS 'Tracks prompt versions for A/B testing and prompt evolution';

COMMENT ON COLUMN vlm_corrections.module IS 'Module: activate, fleet, procurement, assets, staff';
COMMENT ON COLUMN vlm_corrections.analysis_type IS 'Analysis type within module: odometer, ont_serial, power_meter, quote_line_item, etc.';
COMMENT ON COLUMN vlm_corrections.is_canonical IS 'Curated high-quality example - prioritized in few-shot prompts';
COMMENT ON COLUMN vlm_corrections.priority IS 'Priority for few-shot selection (0-100, higher = used first)';
COMMENT ON COLUMN vlm_corrections.context_json IS 'Module-specific context for similarity matching: {vehicleMake, dashboardType, etc.}';

-- ============================================================================
-- Sample Data: Seed with known error patterns for few-shot learning
-- ============================================================================

-- Add canonical examples for common odometer digit confusion
INSERT INTO vlm_corrections (
    module, analysis_type, vlm_extracted_value, corrected_value,
    correction_reason, error_pattern, is_canonical, priority, correction_notes
) VALUES
    ('fleet', 'odometer', '163245', '168245', 'digit_confusion', 'digit_6_8', true, 90,
     'Common: VLM reads 8 as 6 in digital displays'),
    ('fleet', 'odometer', '174582', '114582', 'digit_confusion', 'digit_1_7', true, 90,
     'Common: VLM confuses 1 and 7 in segmented displays'),
    ('fleet', 'fuel_gauge', '75', '25', 'interpretation_error', 'gauge_reversed', true, 85,
     'Some fuel gauges have E on right, F on left - VLM reads backwards')
ON CONFLICT DO NOTHING;

-- Add canonical examples for ONT serial extraction
INSERT INTO vlm_corrections (
    module, analysis_type, vlm_extracted_value, corrected_value,
    correction_reason, error_pattern, is_canonical, priority, correction_notes
) VALUES
    ('activate', 'ont_serial_back', 'ALHN-C397', 'ALCLB6A9C97', 'wrong_field', 'ssid_not_serial', true, 95,
     'CRITICAL: SSID (ALHN-*) is NOT the serial. Serial starts with ALCL/ALCB'),
    ('activate', 'ont_serial_back', 'STN0145844A', 'ALCLB6A9C97', 'wrong_field', 'part_number_not_serial', true, 95,
     'CRITICAL: ONT P/N (STN*) is NOT the serial. Serial starts with ALCL/ALCB')
ON CONFLICT DO NOTHING;
