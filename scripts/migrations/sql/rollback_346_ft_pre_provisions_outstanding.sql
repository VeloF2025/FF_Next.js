-- Rollback for 346_ft_pre_provisions_outstanding.sql

ALTER TABLE ft_weekly_summaries
  DROP COLUMN IF EXISTS ft_pre_provisions_outstanding;
