-- Migration 219: Customer Quotes
-- Sage-parity: quotes that can be converted to invoices

CREATE TABLE IF NOT EXISTS customer_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number VARCHAR(20) UNIQUE NOT NULL,
  client_id UUID,
  customer_name VARCHAR(200) NOT NULL,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted')),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  converted_invoice_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES customer_quotes(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 15,
  line_total NUMERIC(15,2) NOT NULL,
  account_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cq_client ON customer_quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_cq_status ON customer_quotes(status);
CREATE INDEX IF NOT EXISTS idx_cql_quote ON customer_quote_lines(quote_id);
