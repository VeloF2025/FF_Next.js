-- 354: Force-approve audit trail on pole_qa_photos.
-- Works QA reviewers occasionally need to approve a pole before all 21 photo
-- slots are filled — e.g. when a missing photo cannot be re-uploaded but the
-- existing photos are sufficient. The /api/works-qa/pole-approve endpoint
-- previously hard-blocked on the disciplineGatesPass check; this migration
-- adds the columns we need to record an override with a mandatory reason
-- so the bypass is auditable rather than silent.
--
-- Last-override-wins at the row level. If reviewers later want per-discipline
-- audit, backfill into a discipline-keyed JSONB without changing this surface.

ALTER TABLE pole_qa_photos
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS overridden_by   TEXT,
  ADD COLUMN IF NOT EXISTS overridden_at   TIMESTAMPTZ;
