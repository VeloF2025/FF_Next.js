-- scripts/migrations/sql/437_maintenance_step_photos.sql
-- Multi-photo support for verification steps (the slot-aware upload model).
--
-- This table backs the resolve-page slot uploads. The feature code has been
-- live since 2026-05-14 (feat: multi-photo slots per step) and the public
-- snag-resolve GET joins this table for every ticket that has steps.
--
-- The original migration only ever lived in the untracked `migrations/` dated
-- directory (migrations/2026-05-14-maintenance-step-photos.sql), NOT in this
-- runner-scanned `scripts/migrations/sql/` set, so it was never applied by a
-- deploy. Result: the table was absent from the shared DB and the resolve-page
-- GET returned 500 for every in-progress ticket that had steps. Re-homing the
-- forward migration here (idempotent CREATE ... IF NOT EXISTS) closes that
-- dual-tracker drift so a fresh DB rebuild gets the table too.

CREATE TABLE IF NOT EXISTS maintenance_step_photos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id               uuid NOT NULL REFERENCES maintenance_verification_steps(id) ON DELETE CASCADE,
  slot_key              text NOT NULL CHECK (slot_key ~ '^[a-z0-9_]{1,64}$'),
  slot_label            text NOT NULL CHECK (char_length(slot_label) BETWEEN 1 AND 200),
  source_mode           text NOT NULL CHECK (source_mode IN ('camera', 'gallery', 'either')),
  is_required           boolean NOT NULL DEFAULT true,
  photo_url             text CHECK (photo_url IS NULL OR char_length(photo_url) <= 2048),
  uploaded_by_actor_id  uuid REFERENCES share_session_actors(id),
  uploaded_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One slot row per (step, slot_key). UPSERT on upload replaces the photo_url.
CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_step_photos_step_slot
  ON maintenance_step_photos (step_id, slot_key);

CREATE INDEX IF NOT EXISTS idx_maintenance_step_photos_step
  ON maintenance_step_photos (step_id);

CREATE INDEX IF NOT EXISTS idx_maintenance_step_photos_actor
  ON maintenance_step_photos (uploaded_by_actor_id)
  WHERE uploaded_by_actor_id IS NOT NULL;
