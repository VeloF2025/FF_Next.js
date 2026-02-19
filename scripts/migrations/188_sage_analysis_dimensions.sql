-- Migration 188: Sage Analysis Dimensions (Business Units & Sites)
--
-- Stores Sage analysis types (Site, BU), their categories,
-- detailed ledger transactions with analysis codes, and
-- reporting views for P&L by BU/Site.

-- ============================================================================
-- Analysis Types (e.g., "Site", "BU")
-- ============================================================================
CREATE TABLE IF NOT EXISTS sage_analysis_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_type_id VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sage_analysis_types_code ON sage_analysis_types(code);

-- ============================================================================
-- Analysis Categories (individual sites/BUs under a type)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sage_analysis_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_category_id VARCHAR(100) NOT NULL UNIQUE,
  sage_type_id VARCHAR(100) NOT NULL REFERENCES sage_analysis_types(sage_type_id),
  description VARCHAR(255) NOT NULL,
  type_code VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  -- Mapping to FibreFlow
  ff_project_id UUID REFERENCES projects(id),
  mapping_status VARCHAR(20) DEFAULT 'unmapped'
    CHECK (mapping_status IN ('mapped', 'unmapped', 'ignored')),
  mapped_at TIMESTAMP,
  mapped_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sage_analysis_categories_type ON sage_analysis_categories(sage_type_id);
CREATE INDEX idx_sage_analysis_categories_project ON sage_analysis_categories(ff_project_id);
CREATE INDEX idx_sage_analysis_categories_mapping ON sage_analysis_categories(mapping_status);
CREATE INDEX idx_sage_analysis_categories_type_code ON sage_analysis_categories(type_code);

-- ============================================================================
-- Sage Chart of Accounts (local cache)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sage_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_account_id VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category_id VARCHAR(100),
  category_description VARCHAR(255),
  reporting_group_id VARCHAR(100),
  reporting_group_description VARCHAR(255),
  account_type INTEGER,
  is_active BOOLEAN DEFAULT true,
  balance DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sage_accounts_category ON sage_accounts(category_id);
CREATE INDEX idx_sage_accounts_reporting_group ON sage_accounts(reporting_group_id);

-- ============================================================================
-- Detailed Ledger Transactions with Analysis Codes
-- ============================================================================
CREATE TABLE IF NOT EXISTS sage_ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sage_transaction_id VARCHAR(100),
  transaction_date DATE NOT NULL,
  description TEXT,
  document_number VARCHAR(100),
  reference VARCHAR(255),
  -- Account info
  sage_account_id VARCHAR(100) NOT NULL,
  account_name VARCHAR(255),
  -- Amounts
  debit DECIMAL(15,2) DEFAULT 0,
  credit DECIMAL(15,2) DEFAULT 0,
  tax DECIMAL(15,2) DEFAULT 0,
  -- Analysis dimensions (Site + BU)
  sage_site_category_id VARCHAR(100),
  sage_bu_category_id VARCHAR(100),
  -- Derived from mapping
  ff_project_id UUID REFERENCES projects(id),
  ff_business_unit VARCHAR(100),
  -- Source
  source_module VARCHAR(100),
  source_document_id VARCHAR(100),
  -- Sync metadata
  synced_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sage_ledger_date ON sage_ledger_transactions(transaction_date);
CREATE INDEX idx_sage_ledger_account ON sage_ledger_transactions(sage_account_id);
CREATE INDEX idx_sage_ledger_site ON sage_ledger_transactions(sage_site_category_id);
CREATE INDEX idx_sage_ledger_bu ON sage_ledger_transactions(sage_bu_category_id);
CREATE INDEX idx_sage_ledger_project ON sage_ledger_transactions(ff_project_id);
CREATE INDEX idx_sage_ledger_business_unit ON sage_ledger_transactions(ff_business_unit);
CREATE INDEX idx_sage_ledger_date_account ON sage_ledger_transactions(transaction_date, sage_account_id);
-- Composite index for P&L queries
CREATE INDEX idx_sage_ledger_pnl ON sage_ledger_transactions(
  transaction_date, ff_business_unit, ff_project_id, debit, credit
);

-- Prevent duplicate transaction imports
CREATE UNIQUE INDEX idx_sage_ledger_unique ON sage_ledger_transactions(
  sage_account_id, transaction_date, document_number, debit, credit
) WHERE sage_transaction_id IS NULL;

-- ============================================================================
-- ALTER existing tables to add BU/Site tracking
-- ============================================================================

-- Add business_unit to budget_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'budget_transactions' AND column_name = 'business_unit'
  ) THEN
    ALTER TABLE budget_transactions ADD COLUMN business_unit VARCHAR(100);
  END IF;
END $$;

-- Add business_unit to purchase_orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_orders' AND column_name = 'business_unit'
  ) THEN
    ALTER TABLE purchase_orders ADD COLUMN business_unit VARCHAR(100);
  END IF;
END $$;

-- Add sage analysis IDs to sage_supplier_invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sage_supplier_invoices' AND column_name = 'sage_site_id'
  ) THEN
    ALTER TABLE sage_supplier_invoices ADD COLUMN sage_site_id VARCHAR(100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sage_supplier_invoices' AND column_name = 'sage_bu_id'
  ) THEN
    ALTER TABLE sage_supplier_invoices ADD COLUMN sage_bu_id VARCHAR(100);
  END IF;
END $$;

-- ============================================================================
-- Reporting Views
-- ============================================================================

-- P&L by Business Unit (monthly)
CREATE OR REPLACE VIEW v_sage_pnl_by_bu AS
SELECT
  DATE_TRUNC('month', slt.transaction_date) AS month,
  COALESCE(slt.ff_business_unit, 'Unallocated') AS business_unit,
  sa.category_description AS account_category,
  sa.reporting_group_description AS reporting_group,
  sa.name AS account_name,
  sa.sage_account_id,
  SUM(slt.debit) AS total_debit,
  SUM(slt.credit) AS total_credit,
  SUM(slt.debit - slt.credit) AS net_amount,
  COUNT(*) AS transaction_count
FROM sage_ledger_transactions slt
LEFT JOIN sage_accounts sa ON sa.sage_account_id = slt.sage_account_id
GROUP BY
  DATE_TRUNC('month', slt.transaction_date),
  slt.ff_business_unit,
  sa.category_description,
  sa.reporting_group_description,
  sa.name,
  sa.sage_account_id
ORDER BY month DESC, business_unit, account_category;

-- P&L by Site (monthly)
CREATE OR REPLACE VIEW v_sage_pnl_by_site AS
SELECT
  DATE_TRUNC('month', slt.transaction_date) AS month,
  COALESCE(sac.description, 'Unallocated') AS site_name,
  slt.ff_project_id,
  p.project_name,
  sa.category_description AS account_category,
  sa.reporting_group_description AS reporting_group,
  sa.name AS account_name,
  sa.sage_account_id,
  SUM(slt.debit) AS total_debit,
  SUM(slt.credit) AS total_credit,
  SUM(slt.debit - slt.credit) AS net_amount,
  COUNT(*) AS transaction_count
FROM sage_ledger_transactions slt
LEFT JOIN sage_accounts sa ON sa.sage_account_id = slt.sage_account_id
LEFT JOIN sage_analysis_categories sac ON sac.sage_category_id = slt.sage_site_category_id
LEFT JOIN projects p ON p.id = slt.ff_project_id
GROUP BY
  DATE_TRUNC('month', slt.transaction_date),
  sac.description,
  slt.ff_project_id,
  p.project_name,
  sa.category_description,
  sa.reporting_group_description,
  sa.name,
  sa.sage_account_id
ORDER BY month DESC, site_name, account_category;
