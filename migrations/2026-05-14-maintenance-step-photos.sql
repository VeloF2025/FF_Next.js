-- Multi-photo support for verification steps.
--
-- The legacy model is one photo per step (maintenance_verification_steps.photo_url).
-- The new model lets a step define multiple named photo slots (e.g. Step 4
-- "ONT Installation" has slots `ont_closeup`, `ont_wide`). Each slot's photo
-- is stored as a row here, keyed by (step_id, slot_key).
--
-- Backwards compat:
--   - The legacy photo_url column stays on maintenance_verification_steps.
--   - Steps whose template defines photo_slots write to this table.
--   - Steps without photo_slots keep using the legacy column.
--   - The resolve-page API joins both during the transition.

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
