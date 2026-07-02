-- scripts/migrations/sql/436_sitecam_appeals_vlm.sql
-- Auto-Appeals VLM, Phase 1 (shadow mode). Adds ADVISORY recommendation columns
-- to sitecam_appeals. These columns NEVER change `status` — a later go-live
-- migration/flag introduces auto-decisioning. See
-- docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md §5.2.

ALTER TABLE sitecam_appeals
  ADD COLUMN IF NOT EXISTS vlm_recommendation    text
      CHECK (vlm_recommendation IN ('approve','deny','uncertain')),
  ADD COLUMN IF NOT EXISTS vlm_confidence        real,     -- 0..1
  ADD COLUMN IF NOT EXISTS vlm_reasoning         text,     -- free-text "why"
  ADD COLUMN IF NOT EXISTS vlm_checks            jsonb,    -- per-check verdict + evidence
  ADD COLUMN IF NOT EXISTS vlm_serial_read       text,     -- serial mode: serial read off the photo
  ADD COLUMN IF NOT EXISTS vlm_model             text,     -- model id + prompt version (audit)
  ADD COLUMN IF NOT EXISTS vlm_evaluated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS vlm_attempts          smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vlm_skip_reason       text,     -- 'no_photo','vlm_unavailable','unsupported_step','unreadable_image'
  ADD COLUMN IF NOT EXISTS human_agreed_with_vlm boolean;  -- set at human decision time (HITL signal, Phase 3/4)

-- Forward-compat for go-live (spec §5.4b): allow decided_via = 'vlm' now so the
-- later auto-decide cron needs no schema change. Cheap; avoids a future ALTER.
ALTER TABLE sitecam_appeals DROP CONSTRAINT IF EXISTS sitecam_appeals_decided_via_check;
ALTER TABLE sitecam_appeals
  ADD CONSTRAINT sitecam_appeals_decided_via_check
  CHECK (decided_via IN ('whatsapp','in_app','vlm'));

-- Idempotency for the Phase 2 cron: it only scores pending, not-yet-evaluated rows.
CREATE INDEX IF NOT EXISTS sitecam_appeals_vlm_pending
  ON sitecam_appeals(status) WHERE status = 'pending' AND vlm_evaluated_at IS NULL;
