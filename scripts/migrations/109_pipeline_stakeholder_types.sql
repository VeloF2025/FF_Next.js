-- Migration 109: Add stakeholder approval types for Smartsheet sync
-- These are the common service providers found in the Velocity_Master_Tracker

-- ============================================================================
-- TELECOM / FIBRE PROVIDERS
-- ============================================================================

INSERT INTO pipeline_approval_types (code, name, category, description, default_required, is_active, display_order)
VALUES
  ('wayleave_cell_c', 'Wayleave - Cell C', 'wayleave', 'Cell C mobile network crossing approval', false, true, 20),
  ('wayleave_dfa', 'Wayleave - DFA', 'wayleave', 'Dark Fibre Africa crossing approval', false, true, 21),
  ('wayleave_frogfoot', 'Wayleave - Frogfoot', 'wayleave', 'Frogfoot Networks crossing approval', false, true, 22),
  ('wayleave_ict', 'Wayleave - ICT', 'wayleave', 'ICT infrastructure crossing approval', false, true, 23),
  ('wayleave_link_africa', 'Wayleave - Link Africa', 'wayleave', 'Link Africa crossing approval', false, true, 24),
  ('wayleave_liquid', 'Wayleave - Liquid', 'wayleave', 'Liquid Intelligent Technologies crossing approval', false, true, 25),
  ('wayleave_metro_fibre', 'Wayleave - Metro Fibre', 'wayleave', 'Metro Fibre Networx crossing approval', false, true, 26),
  ('wayleave_mtc', 'Wayleave - MTC', 'wayleave', 'MTC crossing approval', false, true, 27),
  ('wayleave_mtn', 'Wayleave - MTN', 'wayleave', 'MTN network crossing approval', false, true, 28),
  ('wayleave_open_serve', 'Wayleave - Open Serve', 'wayleave', 'Open Serve (Telkom) crossing approval', false, true, 29),
  ('wayleave_seacom', 'Wayleave - Seacom', 'wayleave', 'Seacom submarine cable crossing approval', false, true, 30),
  ('wayleave_vodacom', 'Wayleave - Vodacom', 'wayleave', 'Vodacom network crossing approval', false, true, 31),
  ('wayleave_vumatel', 'Wayleave - Vumatel', 'wayleave', 'Vumatel fibre crossing approval', false, true, 32)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- UTILITIES
-- ============================================================================

INSERT INTO pipeline_approval_types (code, name, category, description, default_required, is_active, display_order)
VALUES
  ('wayleave_city_power', 'Wayleave - City Power', 'wayleave', 'City Power (Johannesburg) electricity crossing', false, true, 40),
  ('wayleave_city_parks', 'Wayleave - City Parks', 'wayleave', 'City Parks tree/green space approval', false, true, 41),
  ('wayleave_egoli_gas', 'Wayleave - Egoli Gas', 'wayleave', 'Egoli Gas pipeline crossing approval', false, true, 42),
  ('wayleave_rand_water', 'Wayleave - Rand Water', 'wayleave', 'Rand Water pipeline crossing approval', false, true, 43),
  ('wayleave_sasol', 'Wayleave - Sasol', 'wayleave', 'Sasol gas pipeline crossing approval', false, true, 44),
  ('wayleave_air_products', 'Wayleave - Air Products', 'wayleave', 'Air Products pipeline crossing approval', false, true, 45)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- MUNICIPAL ROADS AGENCIES
-- ============================================================================

INSERT INTO pipeline_approval_types (code, name, category, description, default_required, is_active, display_order)
VALUES
  ('municipal_jra', 'JRA - Johannesburg Roads Agency', 'municipal', 'Johannesburg Roads Agency road crossing approval', false, true, 50),
  ('municipal_ekurhuleni_roads', 'Ekurhuleni Roads', 'municipal', 'Ekurhuleni Metropolitan Municipality roads approval', false, true, 51),
  ('municipal_ekurhuleni_electricity', 'Ekurhuleni Electricity', 'municipal', 'Ekurhuleni electricity infrastructure crossing', false, true, 52),
  ('municipal_ekurhuleni_water', 'Ekurhuleni Water & Sewer', 'municipal', 'Ekurhuleni water and sewer crossing approval', false, true, 53),
  ('municipal_cot_electricity', 'COT Electricity', 'municipal', 'City of Tshwane electricity crossing', false, true, 54),
  ('municipal_cot_water', 'COT Water & Sanitation', 'municipal', 'City of Tshwane water crossing', false, true, 55),
  ('municipal_cot_stormwater', 'COT Stormwater', 'municipal', 'City of Tshwane stormwater infrastructure', false, true, 56),
  ('municipal_cot_forestry', 'COT Urban Forestry', 'municipal', 'City of Tshwane tree/forestry approval', false, true, 57),
  ('municipal_jhb_water', 'Johannesburg Water', 'municipal', 'Johannesburg Water crossing approval', false, true, 58),
  ('municipal_buffalo_city', 'Buffalo City Municipality', 'municipal', 'Buffalo City Metropolitan approval', false, true, 59)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  type_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO type_count
  FROM pipeline_approval_types
  WHERE is_active = true;

  RAISE NOTICE 'Migration 109: Total active approval types: %', type_count;
END $$;
