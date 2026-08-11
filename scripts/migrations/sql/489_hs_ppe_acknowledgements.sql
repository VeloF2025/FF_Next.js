-- 489: PPE acknowledgement sheets.
--
-- Requested by Wiekus 2026-08-11: the PPE issue screen could not hold the
-- signed paper form he actually uses on site. That form ("PPE Acknowledgement")
-- is not a per-item artefact — it is one sheet per worker carrying an indemnity
-- they sign once ("I hereby accept responsibility for items below drawn and
-- signed for by myself…"), followed by ~16 issue lines they sign as each item is
-- drawn, returned to HSE when complete.
--
-- So the sheet is modelled as its own record rather than as an attachment on an
-- issuance row: one scanned sheet evidences many issuances, and hanging it off a
-- single line would misrepresent what the signature covers.
--
-- A worker accumulates sheets over time (a new one starts when the old one
-- fills). Exactly one may be `open` at a time — enforced by a partial unique
-- index, not by convention, so "the worker's current sheet" is unambiguous.
--
-- Issuance is deliberately NOT gated on having a sheet: hs_ppe_issuance
-- .acknowledgement_id is nullable, and an unevidenced issue warns rather than
-- blocks. A hard block on a paperwork step teaches people to work around the
-- system — the same reasoning as the daily check-in's graduated teeth, and this
-- register already has zero rows because staying on paper is easier.
--
-- Rerunnable.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_ppe_acknowledgements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  staff_id        uuid REFERENCES staff(id)        ON DELETE CASCADE,
  team_member_id  uuid REFERENCES team_members(id) ON DELETE CASCADE,
  contractor_id   uuid REFERENCES contractors(id)  ON DELETE SET NULL,
  worker_name     text NOT NULL,
  project_id      uuid REFERENCES projects(id)     ON DELETE SET NULL,

  sheet_date      date        NOT NULL DEFAULT CURRENT_DATE,
  status          varchar(16) NOT NULL DEFAULT 'open',

  -- In-app indemnity signature. Optional: the uploaded sheet is the primary
  -- evidence, and a worker who signed on paper should not have to sign twice.
  signature_name  text,
  signed_at       timestamptz,
  signed_by       uuid,
  signed_ip       varchar(64),

  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Mirrors hs_worker_medicals_one_worker: a sheet belongs to exactly one
  -- worker, internal staff or a contractor's team member.
  CONSTRAINT hs_ppe_acknowledgements_one_worker CHECK (
    (staff_id IS NOT NULL)::int + (team_member_id IS NOT NULL)::int = 1
  ),

  CONSTRAINT hs_ppe_acknowledgements_status CHECK (status IN ('open', 'closed'))
);

-- The invariant that makes "the worker's current sheet" a fact rather than a
-- convention. COALESCE because the worker is one of two columns; partial so a
-- worker may keep any number of closed sheets.
CREATE UNIQUE INDEX IF NOT EXISTS hs_ppe_ack_one_open_per_worker
  ON hs_ppe_acknowledgements (COALESCE(staff_id, team_member_id))
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS hs_ppe_ack_worker_idx
  ON hs_ppe_acknowledgements (COALESCE(staff_id, team_member_id), sheet_date DESC);
CREATE INDEX IF NOT EXISTS hs_ppe_ack_contractor_idx
  ON hs_ppe_acknowledgements (contractor_id) WHERE contractor_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- Link issuances to the sheet that evidences them.
-- --------------------------------------------------------------------------
-- Nullable and ON DELETE SET NULL: an issuance is a fact about equipment that
-- left the store, and it must survive its paperwork being removed. Losing the
-- link degrades the row to "unevidenced", which is exactly what it then is.
ALTER TABLE hs_ppe_issuance
  ADD COLUMN IF NOT EXISTS acknowledgement_id uuid
  REFERENCES hs_ppe_acknowledgements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hs_ppe_issuance_acknowledgement_idx
  ON hs_ppe_issuance (acknowledgement_id) WHERE acknowledgement_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- Attachment arc: the scanned sheet itself.
-- --------------------------------------------------------------------------
ALTER TABLE hs_attachments
  ADD COLUMN IF NOT EXISTS ppe_acknowledgement_id uuid
  REFERENCES hs_ppe_acknowledgements(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS hs_attachments_ppe_acknowledgement_idx
  ON hs_attachments (ppe_acknowledgement_id) WHERE ppe_acknowledgement_id IS NOT NULL;

-- The exclusive-arc CHECK has to be rewritten rather than added to, so it is
-- dropped and recreated under the same name. Safe to re-run: DROP IF EXISTS,
-- then ADD validates every existing row against the new expression.
ALTER TABLE hs_attachments
  DROP CONSTRAINT IF EXISTS hs_attachments_exactly_one_parent;

ALTER TABLE hs_attachments
  ADD CONSTRAINT hs_attachments_exactly_one_parent CHECK (
      (medical_id             IS NOT NULL)::int
    + (contractor_document_id IS NOT NULL)::int
    + (library_id             IS NOT NULL)::int
    + (talk_id                IS NOT NULL)::int
    + (capa_id                IS NOT NULL)::int
    + (letter_id              IS NOT NULL)::int
    + (permit_id              IS NOT NULL)::int
    + (ppe_acknowledgement_id IS NOT NULL)::int
    = 1
  );

COMMIT;
