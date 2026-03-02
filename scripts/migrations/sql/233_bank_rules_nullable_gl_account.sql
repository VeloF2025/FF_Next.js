-- Migration 233: Make gl_account_id nullable on bank_categorisation_rules
-- Supplier/customer rules don't need a GL account — AP/AR is auto-determined

ALTER TABLE bank_categorisation_rules
  ALTER COLUMN gl_account_id DROP NOT NULL;
