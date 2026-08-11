-- Rollback 489: remove PPE acknowledgement sheets.
--
-- Order matters. The attachment arc and the issuance link are dropped BEFORE
-- the table, because both reference it; dropping the table first would either
-- fail or require a CASCADE that silently takes the columns with it.
--
-- The exclusive-arc CHECK on hs_attachments is restored to its 487 form —
-- WITHOUT ppe_acknowledgement_id. Dropping the column without rewriting the
-- constraint would leave a CHECK referring to a column that no longer exists.
--
-- NOTE: this drops the metadata, not the stored objects. Any uploaded sheets
-- remain in VF Storage under hs-private/ppe_acknowledgements/ and become
-- unreferenced. Capture them BEFORE running this:
--
--   SELECT file_path FROM hs_attachments WHERE ppe_acknowledgement_id IS NOT NULL;
--
-- Rerunnable.

BEGIN;

ALTER TABLE hs_attachments
  DROP CONSTRAINT IF EXISTS hs_attachments_exactly_one_parent;

ALTER TABLE hs_attachments
  DROP COLUMN IF EXISTS ppe_acknowledgement_id;

ALTER TABLE hs_attachments
  ADD CONSTRAINT hs_attachments_exactly_one_parent CHECK (
      (medical_id             IS NOT NULL)::int
    + (contractor_document_id IS NOT NULL)::int
    + (library_id             IS NOT NULL)::int
    + (talk_id                IS NOT NULL)::int
    + (capa_id                IS NOT NULL)::int
    + (letter_id              IS NOT NULL)::int
    + (permit_id              IS NOT NULL)::int
    = 1
  );

ALTER TABLE hs_ppe_issuance
  DROP COLUMN IF EXISTS acknowledgement_id;

DROP TABLE IF EXISTS hs_ppe_acknowledgements;

COMMIT;
