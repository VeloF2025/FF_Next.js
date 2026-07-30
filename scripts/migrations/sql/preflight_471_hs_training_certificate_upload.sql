-- Preflight for 471_hs_training_certificate_upload.sql — READ ONLY.
--
-- Run this against the shared database and paste the output into the migration
-- approval request. Nothing in this file writes.
--
--   duplicate_certification_count
--     Must be 0. Migration 471 builds a partial unique index over
--     (staff_id, lower(btrim(document_number)), lower(btrim(issuing_authority)))
--     for live certification documents. Any collision makes that index fail to
--     build, which aborts the whole migration.
--
--   existing_training_count
--     How many hs_worker_training rows the one-time backfill will stamp as
--     'verified'. These predate the upload workflow: they were typed in by hand
--     and were already treated as accepted evidence.
--
--   revoked_staff_document_count
--     Expected 0. The 'revoked' state does not exist before 471, so anything
--     other than 0 means a writer bypassed the documented vocabulary.

SELECT COUNT(*) AS duplicate_certification_count
FROM (
  SELECT staff_id, LOWER(BTRIM(document_number)), LOWER(BTRIM(issuing_authority))
  FROM staff_documents
  WHERE document_type = 'certification'
    AND verification_status IN ('pending', 'verified')
    AND NULLIF(BTRIM(document_number), '') IS NOT NULL
    AND NULLIF(BTRIM(issuing_authority), '') IS NOT NULL
  GROUP BY staff_id, LOWER(BTRIM(document_number)), LOWER(BTRIM(issuing_authority))
  HAVING COUNT(*) > 1
) conflicts;

SELECT COUNT(*) AS existing_training_count FROM hs_worker_training;

SELECT COUNT(*) AS revoked_staff_document_count
FROM staff_documents WHERE verification_status = 'revoked';
