-- 306_backfill_verification_step_attachments.sql
--
-- Multi-photo verification steps (PR #1338) keep the full gallery in
-- maintenance_attachments, joined back to the step via verification_step_id.
-- Photos uploaded under the old single-photo UI only exist in
-- maintenance_verification_steps.photo_url — never got an attachment row.
-- Without this backfill, those legacy photos stop appearing in the new
-- gallery UI.
--
-- Idempotent: only inserts attachments for (step_id, photo_url) pairs that
-- don't already have a matching attachment row.

BEGIN;

INSERT INTO maintenance_attachments (
  ticket_id,
  filename,
  file_type,
  mime_type,
  storage_url,
  storage_path,
  uploaded_by,
  verification_step_id,
  is_evidence,
  uploaded_at
)
SELECT
  s.ticket_id,
  -- storage_path last segment, with a deterministic fallback so NOT NULL
  -- filename is always satisfied even for legacy uploads without a path.
  COALESCE(
    NULLIF(regexp_replace(s.photo_url, '^.*/', ''), ''),
    'verification-step-' || s.step_number || '.jpg'
  ) AS filename,
  'photo' AS file_type,
  'image/jpeg' AS mime_type,
  s.photo_url AS storage_url,
  -- Derive storage_path from the URL. VF Storage URLs look like
  -- "https://vf.fibreflow.app/storage/maintenance/verification-photos/<file>"
  -- or the relative form "/storage/maintenance/verification-photos/<file>" —
  -- stripping everything up to and including "/storage/" yields the
  -- {type}/{category}/{filename} shape the attachment service expects. Non-
  -- VF URLs fall through to the full URL, which the delete path safely logs
  -- and skips rather than crashing.
  regexp_replace(s.photo_url, '^.*?/storage/', '') AS storage_path,
  -- Prefer the user who marked the step complete; fall back to the ticket
  -- creator so `uploaded_by NOT NULL` is satisfied. (FK lookup via ticket.)
  COALESCE(s.completed_by, t.created_by) AS uploaded_by,
  s.id AS verification_step_id,
  TRUE AS is_evidence,
  COALESCE(s.completed_at, s.created_at, NOW()) AS uploaded_at
FROM maintenance_verification_steps s
JOIN maintenance_tickets t ON t.id = s.ticket_id
WHERE s.photo_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM maintenance_attachments a
    WHERE a.verification_step_id = s.id
      AND a.is_evidence = TRUE
  );

COMMIT;
