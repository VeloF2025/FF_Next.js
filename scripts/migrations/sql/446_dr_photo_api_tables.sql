-- 446: dr-photo-api (BOSS) persistence tables
--
-- The standalone dr-photo-api service (scripts/dr-photo-api/) — the BOSS
-- container FibreFlow's WA acknowledgment calls for 1Map DR lookups — has its
-- own optional persistence layer (PhotoDatabase in api/dr_photo_api.py) that
-- has been pointed at a now-retired Neon project since before this repo
-- preserved the source. These 3 tables were never captured in any migration
-- (the app code assumes they already exist) and had to be reconstructed by
-- reading every INSERT/UPDATE/SELECT against them in the source.
--
-- Scope: this only enables BOSS's OWN internal QA-evaluation dashboard
-- (/api/evaluate, /api/qa/*, /api/sessions) — FibreFlow itself only ever
-- calls /api/record, /api/download, /api/photo, none of which touch these
-- tables, so this migration has zero effect on FibreFlow's own behavior.
--
-- Historical data note: the old Neon project is unreachable with current
-- credentials (auth rejected, not just network-down) — any pre-2026-07-14
-- QA evaluation history in it could not be recovered or migrated forward.
-- These tables start empty.

CREATE TABLE IF NOT EXISTS dr_photo_downloads (
    id UUID PRIMARY KEY,
    dr_number TEXT NOT NULL,
    project TEXT,
    filename TEXT NOT NULL,
    file_path TEXT,
    file_size BIGINT,
    file_hash TEXT UNIQUE,
    onemap_layer_id TEXT,
    onemap_attachment_id TEXT,
    content_type TEXT,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- GPS/EXIF metadata (lib/image/exif_extractor.py, gps_validator.py)
    exif_data JSONB,
    gps_latitude DOUBLE PRECISION,
    gps_longitude DOUBLE PRECISION,
    gps_altitude DOUBLE PRECISION,
    photo_datetime TIMESTAMPTZ,
    camera_make TEXT,
    camera_model TEXT,
    orientation INTEGER,
    gps_validation_status TEXT,
    gps_distance_from_site_km DOUBLE PRECISION,

    -- AI/QA evaluation (Gemini/OpenAI/Claude cascade)
    ai_verification_status TEXT,
    ai_verification_result JSONB,
    ai_confidence DOUBLE PRECISION,
    qa_provider TEXT,
    qa_cost DOUBLE PRECISION,
    qa_latency_ms INTEGER,
    analyzed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dr_photo_downloads_dr_number ON dr_photo_downloads (dr_number);
CREATE INDEX IF NOT EXISTS idx_dr_photo_downloads_project ON dr_photo_downloads (project);
CREATE INDEX IF NOT EXISTS idx_dr_photo_downloads_analyzed_at ON dr_photo_downloads (analyzed_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS dr_qa_audit_log (
    id BIGSERIAL PRIMARY KEY,
    dr_number TEXT NOT NULL,
    project TEXT,
    provider TEXT,
    accepted BOOLEAN,
    confidence DOUBLE PRECISION,
    cost DOUBLE PRECISION,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dr_qa_audit_log_dr_number ON dr_qa_audit_log (dr_number);

CREATE TABLE IF NOT EXISTS dr_sharepoint_sync_log (
    id BIGSERIAL PRIMARY KEY,
    dr_number TEXT NOT NULL,
    project TEXT,
    status TEXT,
    files_synced INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dr_sharepoint_sync_log_dr_number ON dr_sharepoint_sync_log (dr_number);
