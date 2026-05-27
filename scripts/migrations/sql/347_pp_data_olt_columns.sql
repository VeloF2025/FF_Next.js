-- Migration 347: Add OLT port columns to oes_pp_data
-- Stores Nokia OLT port info sourced from Velocity PPs Excel export.
-- Populated for ALL records regardless of resolution status.

ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS olt_port    TEXT,
  ADD COLUMN IF NOT EXISTS olt_address TEXT,
  ADD COLUMN IF NOT EXISTS olt_name    TEXT,
  ADD COLUMN IF NOT EXISTS olt_lt      SMALLINT,
  ADD COLUMN IF NOT EXISTS olt_pon     SMALLINT,
  ADD COLUMN IF NOT EXISTS olt_ont_pos SMALLINT;

CREATE INDEX IF NOT EXISTS idx_oes_pp_data_olt_pon ON oes_pp_data(olt_pon) WHERE olt_pon IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_olt_lt  ON oes_pp_data(olt_lt)  WHERE olt_lt  IS NOT NULL;
