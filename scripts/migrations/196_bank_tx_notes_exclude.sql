-- Migration 196: Add notes and exclude_reason to bank_transactions
-- Purpose: Support "Exclude with Reason" workflow so excluded transactions carry context

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS exclude_reason TEXT;
