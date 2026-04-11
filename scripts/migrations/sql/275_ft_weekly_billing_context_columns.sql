-- Migration 275: Add context columns to ft_weekly_billing
-- Context: Weekly billing upload now captures Site, Contractor, Area Manager,
-- and the "Lower than Link Budget threshold" count from the FiberTime PDF
-- header. These were visible in every PDF but never stored.
-- Safety: Additive only — all columns nullable, no data loss.

ALTER TABLE ft_weekly_billing
  ADD COLUMN IF NOT EXISTS site VARCHAR(100),
  ADD COLUMN IF NOT EXISTS contractor VARCHAR(100),
  ADD COLUMN IF NOT EXISTS area_manager VARCHAR(200),
  ADD COLUMN IF NOT EXISTS lower_than_link_budget_count INTEGER DEFAULT 0;

COMMENT ON COLUMN ft_weekly_billing.site
  IS 'Site label from FT PDF header (e.g. "Lawley", "Tembisa")';
COMMENT ON COLUMN ft_weekly_billing.contractor
  IS 'Contractor from FT PDF header (e.g. "Velocity Fibre")';
COMMENT ON COLUMN ft_weekly_billing.area_manager
  IS 'Area manager name from FT PDF header';
COMMENT ON COLUMN ft_weekly_billing.lower_than_link_budget_count
  IS 'FT "Lower than Link Budget threshold" count — distinct from Note 1 "Lower than -26 dB"';
