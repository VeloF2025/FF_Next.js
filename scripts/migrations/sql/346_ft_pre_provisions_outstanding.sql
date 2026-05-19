-- 346_ft_pre_provisions_outstanding.sql
-- Add a separate column for the OES Report cumulative pre-provisioned drops
-- ("outstanding inventory"), distinct from the current-week withhold count.
--
-- Background: the FT payment summary PDF prints two numbers on the
-- Pre-Provisioned line:
--   col 1 = current-week 20% withhold count (deducted from this week's payment)
--   col 2 = OES Report cumulative — running balance of pre-provisioned drops
--           awaiting resolution. NOT a deduction; tracked as inventory.
--
-- Prior to PR #1665, the parser conflated these. ft_pre_provisions_count was
-- being populated with the OES cumulative instead of the current-week count,
-- which broke the payment-math reconciliation. PR #1665 fixed the parser to
-- read col 1 — but that dropped the OES inventory metric from the weekly
-- table. This migration restores it as a separate, correctly-named column.
--
-- Existing rows: ft_pre_provisions_outstanding defaults to 0 — historical
-- ft_pre_provisions_count values may contain the old (wrong) OES cumulative
-- but are left untouched. A separate backfill could read source PDFs from
-- storage if needed.

ALTER TABLE ft_weekly_summaries
  ADD COLUMN IF NOT EXISTS ft_pre_provisions_outstanding INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN ft_weekly_summaries.ft_pre_provisions_count IS
  'Current-week 20% withhold count (PDF Pre-Provisioned col 1). Deducted from this week''s payment.';

COMMENT ON COLUMN ft_weekly_summaries.ft_pre_provisions_outstanding IS
  'OES Report cumulative — running balance of pre-provisioned drops awaiting resolution (PDF Pre-Provisioned col 2). Inventory metric, NOT a payment deduction.';
