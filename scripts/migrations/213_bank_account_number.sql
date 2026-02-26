-- Migration 213: Add bank_account_number to gl_accounts
-- Allows distinguishing between multiple accounts at the same bank (e.g. ABSA Current vs ABSA Savings)

ALTER TABLE gl_accounts
  ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50);
