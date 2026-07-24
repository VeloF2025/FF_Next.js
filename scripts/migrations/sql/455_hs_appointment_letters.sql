-- 455: H&S statutory appointment letters (goal Phase 5)
--
-- The OHS Act / Construction Regulations appointment letters that make up the
-- legal safety file: s16(2) (CEO's assignment of the s16.1 duty), s8(1)
-- (construction supervisor), the construction-supervisor appointment, and the
-- Construction Reg 5 Annexure 3 H&S agreement.
--
-- Signature is DRAWN for these (Hein, §4.5 gate decision — the safety file
-- legally expects an actual signature on an appointment), stored as a PNG data
-- URL, alongside the §4.5 audit metadata (who/when/where) so the drawn mark is
-- still attributable and unforgeable in its provenance.
--
-- Idempotent. Rollback: rollback_455_hs_appointment_letters.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_appointment_letters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_type         varchar(32) NOT NULL,
  reference_number    varchar(40) NOT NULL,
  project_id          uuid REFERENCES projects(id) ON DELETE SET NULL,
  contractor_id       uuid REFERENCES contractors(id) ON DELETE SET NULL,
  appointer_name      text,
  appointer_designation text,
  appointee_name      text NOT NULL,
  appointee_designation text,
  scope               text,
  appointment_date    date,
  effective_from      date,
  status              varchar(16) NOT NULL DEFAULT 'draft',
  -- DRAWN signature (PNG data URL) + §4.5 audit metadata
  signature_image     text,
  signature_name      text,
  signed_at           timestamptz,
  signed_by           uuid,
  signed_ip           varchar(64),
  notes               text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_appointment_letters_type_check
    CHECK (letter_type IN ('s16_2','s8_1','construction_supervisor','annexure_3')),
  CONSTRAINT hs_appointment_letters_status_check
    CHECK (status IN ('draft','signed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS hs_appointment_letters_ref_key ON hs_appointment_letters (reference_number);
CREATE INDEX IF NOT EXISTS hs_appointment_letters_project_idx ON hs_appointment_letters (project_id);
CREATE INDEX IF NOT EXISTS hs_appointment_letters_contractor_idx ON hs_appointment_letters (contractor_id);
CREATE INDEX IF NOT EXISTS hs_appointment_letters_type_idx ON hs_appointment_letters (letter_type);

COMMIT;
