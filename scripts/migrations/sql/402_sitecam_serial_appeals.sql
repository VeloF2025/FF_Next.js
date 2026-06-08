-- scripts/migrations/sql/402_sitecam_serial_appeals.sql
-- Adds serial scan tracking columns to dr_photo_unified_reviews.
-- ont_serial_scanned / ups_serial_scanned already exist (migration 364/365).
-- We add attempt counters and status for the PWA 3-strike logic.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS ont_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ont_serial_status    text CHECK (ont_serial_status IN ('pending','pass','fail','locked')),
  ADD COLUMN IF NOT EXISTS ups_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ups_serial_status    text CHECK (ups_serial_status IN ('pending','pass','fail','locked'));

-- Appeal records: one row per appeal submission from a technician.
CREATE TABLE IF NOT EXISTS sitecam_appeals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dr_number        text        NOT NULL,
  step_number      smallint    NOT NULL,
  technician_id    uuid        NOT NULL REFERENCES users(id),
  appeal_text      text        NOT NULL,
  photo_url        text        NOT NULL,
  serial_scanned   text,
  serial_expected  text,
  attempt_number   smallint    NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','denied')),
  decided_by       uuid        REFERENCES users(id),
  decided_via      text        CHECK (decided_via IN ('whatsapp','in_app')),
  decided_at       timestamptz,
  denial_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sitecam_appeals_dr_step
  ON sitecam_appeals(dr_number, step_number);
CREATE INDEX IF NOT EXISTS sitecam_appeals_pending
  ON sitecam_appeals(status) WHERE status = 'pending';
