-- 444: SiteCam step-6 photo VLM UPS serial read.
-- vlm_ont_serial_step6 already exists (dormant); this adds the UPS counterpart so
-- the step-6 photo can contribute BOTH serials to the 4-way verification engine.
-- Purely additive, nullable — safe to apply any time.
BEGIN;
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS vlm_ups_serial_step6 TEXT;
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_ups_serial_step6 IS
  'Gizzu UPS serial the VLM read from the step-6 ONT-back photo. Corroboration only; the trusted value stays ups_serial_scanned.';
COMMIT;
