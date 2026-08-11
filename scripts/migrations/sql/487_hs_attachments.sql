-- 487: H&S document attachments.
--
-- Replaces free-text document URLs across the Health & Safety module with
-- uploaded files. One table serves all seven surfaces so there is a single
-- download route to permission-check and a single place to test.
--
-- Seven nullable foreign keys with an exclusive-arc CHECK, rather than a
-- polymorphic (entity_type, entity_id) pair. This module already has the
-- polymorphic shape in hs_ticket_details and its own .claude.md flags it as
-- "NO FK — orphans possible". Real foreign keys with ON DELETE CASCADE mean
-- deleting a medical record cannot strand a health-data file.
--
-- file_path holds the VF Storage path under the private hs-private/ prefix,
-- never a public URL: /storage/hs-private/ is 403'd at nginx and the bytes are
-- served only by /api/health-safety/attachments/download, which re-checks
-- permission on every request. See docs/VPS/vf-fibreflow.nginx.conf.
--
-- Rerunnable.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_attachments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  medical_id             uuid REFERENCES hs_worker_medicals(id)      ON DELETE CASCADE,
  contractor_document_id uuid REFERENCES hs_contractor_documents(id) ON DELETE CASCADE,
  library_id             uuid REFERENCES hs_safety_library(id)       ON DELETE CASCADE,
  talk_id                uuid REFERENCES hs_toolbox_talks(id)        ON DELETE CASCADE,
  capa_id                uuid REFERENCES hs_corrective_actions(id)   ON DELETE CASCADE,
  letter_id              uuid REFERENCES hs_appointment_letters(id)  ON DELETE CASCADE,
  permit_id              uuid REFERENCES hs_permits(id)              ON DELETE CASCADE,

  file_path              text        NOT NULL,
  file_name              text        NOT NULL,
  file_size              integer     NOT NULL,
  mime_type              text        NOT NULL,
  uploaded_by            uuid        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- Named so the tests can assert the constraint that refused a bad row, not
  -- merely that some error occurred.
  CONSTRAINT hs_attachments_exactly_one_parent CHECK (
      (medical_id             IS NOT NULL)::int
    + (contractor_document_id IS NOT NULL)::int
    + (library_id             IS NOT NULL)::int
    + (talk_id                IS NOT NULL)::int
    + (capa_id                IS NOT NULL)::int
    + (letter_id              IS NOT NULL)::int
    + (permit_id              IS NOT NULL)::int
    = 1
  ),

  CONSTRAINT hs_attachments_file_size_positive CHECK (file_size > 0)
);

-- One partial index per arc: every listing query filters on exactly one parent
-- column, and a partial index skips the six NULLs that a composite would carry.
CREATE INDEX IF NOT EXISTS hs_attachments_medical_idx
  ON hs_attachments (medical_id) WHERE medical_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_attachments_contractor_document_idx
  ON hs_attachments (contractor_document_id) WHERE contractor_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_attachments_library_idx
  ON hs_attachments (library_id) WHERE library_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_attachments_talk_idx
  ON hs_attachments (talk_id) WHERE talk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_attachments_capa_idx
  ON hs_attachments (capa_id) WHERE capa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_attachments_letter_idx
  ON hs_attachments (letter_id) WHERE letter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_attachments_permit_idx
  ON hs_attachments (permit_id) WHERE permit_id IS NOT NULL;

-- The compensating delete after a failed insert needs to find the object by
-- path, and the orphan-reconciliation query joins on it.
CREATE UNIQUE INDEX IF NOT EXISTS hs_attachments_file_path_key
  ON hs_attachments (file_path);

COMMIT;
