-- Migration 215: Customer & Supplier Categories Tables
-- Sage Parity: Lists > Customer Categories / Supplier Categories

CREATE TABLE IF NOT EXISTS customer_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add category column to suppliers if missing
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Seed common categories
INSERT INTO customer_categories (name, description) VALUES
  ('Enterprise', 'Large corporate clients'),
  ('SME', 'Small and medium enterprises'),
  ('Government', 'Government and public sector'),
  ('Residential', 'Individual residential customers'),
  ('Wholesale', 'Wholesale/reseller accounts')
ON CONFLICT (name) DO NOTHING;

INSERT INTO supplier_categories (name, description) VALUES
  ('Materials', 'Raw materials and components'),
  ('Equipment', 'Tools, machinery and equipment'),
  ('Services', 'Professional and contractor services'),
  ('Logistics', 'Transport and logistics providers'),
  ('Utilities', 'Utility service providers')
ON CONFLICT (name) DO NOTHING;
