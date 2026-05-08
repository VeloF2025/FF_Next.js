-- Migration 335: Extend pon_stage_tracking for tracker-workspace consolidation
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.1
--
-- Adds the columns currently held by pon_tracker_entries / sp_pon_tracker so that
-- pon_stage_tracking becomes the canonical PON entity for the new workspace.
-- All columns are nullable — existing rows are unaffected.

BEGIN;

ALTER TABLE pon_stage_tracking
  ADD COLUMN IF NOT EXISTS olt_port      varchar(120),
  ADD COLUMN IF NOT EXISTS hld_pon       integer,
  ADD COLUMN IF NOT EXISTS z_pon         integer,
  ADD COLUMN IF NOT EXISTS scope_string  integer,
  ADD COLUMN IF NOT EXISTS sign_ups      integer,
  ADD COLUMN IF NOT EXISTS homes_po      integer,
  ADD COLUMN IF NOT EXISTS homes_recon   integer,
  ADD COLUMN IF NOT EXISTS available     integer,
  ADD COLUMN IF NOT EXISTS pct_original  numeric(5, 4),
  ADD COLUMN IF NOT EXISTS pct_recon     numeric(5, 4);

-- olt_port is high-cardinality and queried by the workspace; index it.
CREATE INDEX IF NOT EXISTS idx_pon_stage_olt_port
  ON pon_stage_tracking (project_id, olt_port)
  WHERE olt_port IS NOT NULL;

COMMENT ON COLUMN pon_stage_tracking.olt_port     IS 'Runtime PON identifier from Nokia, e.g. LAW.FTS.16.AGG.DM.MH.A004-OLT.01.C1P1';
COMMENT ON COLUMN pon_stage_tracking.hld_pon      IS 'Project-level (HLD) PON number. Distinct from pon_no which is zone-level.';
COMMENT ON COLUMN pon_stage_tracking.z_pon        IS 'Zone-level PON number as recorded in the Excel tracker (mirrors pon_no for legacy parity).';
COMMENT ON COLUMN pon_stage_tracking.scope_string IS 'Pole/span count for scoped stringing work on this PON. Integer count from Excel "Scope - String", NOT a metres length. If a future ingestion needs sub-unit precision the type should be migrated to numeric(10,2).';
COMMENT ON COLUMN pon_stage_tracking.pct_original IS 'Activations as a fraction of homes_po (0.0–1.0). numeric(5,4) — application MUST clamp to [0,1] before write; any value ≥ 10.0 will overflow.';
COMMENT ON COLUMN pon_stage_tracking.pct_recon    IS 'Activations as a fraction of homes_recon (0.0–1.0). numeric(5,4) — application MUST clamp to [0,1] before write; any value ≥ 10.0 will overflow.';
COMMENT ON COLUMN pon_stage_tracking.sign_ups     IS 'Number of homes signed up (manual + 1Map merged).';
COMMENT ON COLUMN pon_stage_tracking.homes_po     IS 'Homes connected via PO drops (original scope).';
COMMENT ON COLUMN pon_stage_tracking.homes_recon  IS 'Homes connected via reconnaissance / re-survey scope.';
COMMENT ON COLUMN pon_stage_tracking.available    IS 'Homes ready to activate but not yet activated.';

COMMIT;
