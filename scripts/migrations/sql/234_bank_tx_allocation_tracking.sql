-- Migration 234: Add allocation tracking columns to bank_transactions
-- Shows which account/supplier/customer a matched transaction was allocated to

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS allocation_type TEXT,
  ADD COLUMN IF NOT EXISTS allocated_entity_name TEXT;

-- Backfill existing matched transactions from journal entries
WITH allocations AS (
  SELECT
    bt.id AS bank_tx_id,
    CASE
      WHEN je.source = 'auto_supplier_payment' THEN 'supplier'
      WHEN je.source = 'auto_payment' THEN 'customer'
      ELSE 'account'
    END AS alloc_type,
    je.description AS alloc_desc,
    je.id AS je_id,
    bt.bank_account_id
  FROM bank_transactions bt
  JOIN gl_journal_lines jl ON jl.id = bt.matched_journal_line_id
  JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
  WHERE bt.status IN ('matched', 'reconciled')
    AND bt.allocation_type IS NULL
)
UPDATE bank_transactions bt
SET
  allocation_type = a.alloc_type,
  allocated_entity_name = CASE
    WHEN a.alloc_type = 'supplier' THEN REGEXP_REPLACE(a.alloc_desc, '^Payment to ', '')
    WHEN a.alloc_type = 'customer' THEN REGEXP_REPLACE(a.alloc_desc, '^Receipt from ', '')
    ELSE COALESCE(
      (SELECT ga.account_code || ' ' || ga.account_name
       FROM gl_journal_lines contra
       JOIN gl_accounts ga ON ga.id = contra.gl_account_id
       WHERE contra.journal_entry_id = a.je_id
         AND contra.gl_account_id != a.bank_account_id
         AND ga.account_code NOT IN ('1140', '2120')
       LIMIT 1),
      a.alloc_desc
    )
  END
FROM allocations a
WHERE bt.id = a.bank_tx_id;
