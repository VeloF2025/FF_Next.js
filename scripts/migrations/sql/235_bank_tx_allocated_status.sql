-- Migration 235: Add 'allocated' to bank_transactions status check constraint
-- Supports two-step workflow: imported → allocated → matched

ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_status_check;

ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_status_check
  CHECK (status IN ('imported', 'allocated', 'matched', 'reconciled', 'excluded'));
