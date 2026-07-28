-- 463: per-worker medical fitness register (H&S docs-vs-module alignment audit, rec #3)
--
-- The 2026-07-25 audit compared Velocity Fibre's real client H&S files against
-- this module. Every client folder carries per-WORKER Certificate of Fitness
-- (medical) PDFs -- 16 individual ones at Herotel alone -- but the only home the
-- module had was hs_contractor_documents.document_type = 'medical_fitness',
-- which is contractor-level (one row per company). There was no way to answer
-- "is THIS worker medically fit, and when does their certificate lapse?".
--
-- Shape decision (Hein, 2026-07-27, chosen over reusing hs_training_types):
--   a dedicated table, because a Certificate of Fitness carries data a training
--   record structurally cannot -- the medical OUTCOME (fit / fit with
--   restriction / unfit) and the restrictions themselves. Filing it as a
--   "training type" would have forced that verdict into free-text notes and
--   made an unfit worker indistinguishable from a fit one at the gate.
--
-- Mirrors hs_worker_training (migration 451) deliberately:
--   * polymorphic worker reference -- exactly one of staff_id (internal) or
--     team_member_id (contractor field worker), inventing no new person table;
--   * contractor_id carried directly as the authoritative worker->contractor
--     link for gate aggregation (team_members' own link is unpopulated);
--   * expiry-driven status derived in SQL at read time, never stored.
--
-- Idempotent: safe to run against live and to re-run under the deploy's
-- run-pending-migrations.sh. Rollback: rollback_463_hs_worker_medicals.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_worker_medicals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- exactly one worker reference (enforced below)
  staff_id           uuid REFERENCES staff(id) ON DELETE CASCADE,
  team_member_id     uuid REFERENCES team_members(id) ON DELETE CASCADE,
  -- authoritative worker->contractor link for gate aggregation; NULL = internal
  contractor_id      uuid REFERENCES contractors(id) ON DELETE CASCADE,
  -- display snapshot so lists render without a live join (matches 451)
  worker_name        text NOT NULL,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  exam_date          date NOT NULL,
  -- NULL = no stated expiry; else drives fitness status in SQL
  expiry_date        date,
  -- the medical verdict: this is what a training record could not express
  outcome            varchar(24) NOT NULL DEFAULT 'fit',
  restrictions       text,
  practitioner       varchar(160),
  practice_number    varchar(60),
  certificate_number varchar(120),
  certificate_url    text,
  notes              text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_worker_medicals_one_worker
    CHECK ((staff_id IS NOT NULL)::int + (team_member_id IS NOT NULL)::int = 1),
  CONSTRAINT hs_worker_medicals_expiry_after_exam
    CHECK (expiry_date IS NULL OR expiry_date >= exam_date),
  CONSTRAINT hs_worker_medicals_outcome_check
    CHECK (outcome IN ('fit', 'fit_with_restriction', 'unfit')),
  -- "fit with restriction" without stating the restriction is not a usable
  -- record -- the whole point of that outcome is the restriction text.
  CONSTRAINT hs_worker_medicals_restrictions_stated
    CHECK (outcome <> 'fit_with_restriction' OR btrim(coalesce(restrictions, '')) <> '')
);

CREATE INDEX IF NOT EXISTS hs_worker_medicals_contractor_idx
  ON hs_worker_medicals (contractor_id);
CREATE INDEX IF NOT EXISTS hs_worker_medicals_staff_idx
  ON hs_worker_medicals (staff_id);
CREATE INDEX IF NOT EXISTS hs_worker_medicals_team_member_idx
  ON hs_worker_medicals (team_member_id);
CREATE INDEX IF NOT EXISTS hs_worker_medicals_expiry_idx
  ON hs_worker_medicals (expiry_date);
CREATE INDEX IF NOT EXISTS hs_worker_medicals_project_idx
  ON hs_worker_medicals (project_id);
-- The gate reads the LATEST medical per worker; this backs the DISTINCT ON.
CREATE INDEX IF NOT EXISTS hs_worker_medicals_worker_latest_idx
  ON hs_worker_medicals (contractor_id, coalesce(staff_id, team_member_id), exam_date DESC);

COMMIT;
