-- Migration 390: PhotoGuide PWA support
-- Adds pwa_escalations + pwa_photo_hashes tables and PWA tracking columns.

-- PWA tracking columns on DR review records
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS pwa_submission_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pwa_tech_id        UUID,
  ADD COLUMN IF NOT EXISTS pwa_photo_count    INT,
  ADD COLUMN IF NOT EXISTS pwa_completed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pwa_photo_urls     JSONB;

-- PWA tracking columns on pole install sessions (Civils job type)
ALTER TABLE pole_install_sessions
  ADD COLUMN IF NOT EXISTS pwa_submission_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pwa_tech_id        UUID,
  ADD COLUMN IF NOT EXISTS pwa_completed_at   TIMESTAMPTZ;

-- Escalation records — one row per step flagged after 3 failed attempts
CREATE TABLE IF NOT EXISTS pwa_escalations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type         TEXT        NOT NULL CHECK (job_type IN ('activations', 'civils')),
  site_id          TEXT        NOT NULL,
  step_number      INT         NOT NULL,
  tech_id          UUID,
  fail_reasons     TEXT[]      NOT NULL DEFAULT '{}',
  attempt_photos   JSONB       NOT NULL DEFAULT '[]',
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwa_escalations_status  ON pwa_escalations (status);
CREATE INDEX IF NOT EXISTS idx_pwa_escalations_site    ON pwa_escalations (site_id);
CREATE INDEX IF NOT EXISTS idx_pwa_escalations_tech    ON pwa_escalations (tech_id);

-- Photo hash dedup — prevents a technician reusing the same photo across retries
CREATE TABLE IF NOT EXISTS pwa_photo_hashes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      TEXT        NOT NULL,
  step_number  INT         NOT NULL,
  photo_hash   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, photo_hash)
);

CREATE INDEX IF NOT EXISTS idx_pwa_photo_hashes_site ON pwa_photo_hashes (site_id);
