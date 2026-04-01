-- Migration 269: Add edit tracking columns to fleet_odometer_history
-- Enables admin correction of odometer readings

ALTER TABLE fleet_odometer_history
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

INSERT INTO migrations (version, name, success)
VALUES ('269', 'odometer_history_edit_columns', true)
ON CONFLICT (version) DO NOTHING;
