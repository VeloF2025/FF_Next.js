-- Migration: 081_photo_step_mappings
-- Photo step mappings for 1Map photo types
-- Source of truth is stepMapper.ts, this table enables admin UI management
-- Created: 2026-01-17

-- ============================================
-- 1. Create photo_step_mappings table
-- ============================================

CREATE TABLE IF NOT EXISTS photo_step_mappings (
  id SERIAL PRIMARY KEY,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 10),
  step_label VARCHAR(50) NOT NULL,
  photo_type VARCHAR(30) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. Seed data from stepMapper.ts
-- ============================================

INSERT INTO photo_step_mappings (step_number, step_label, photo_type, description) VALUES
  -- Step 1: House Photo
  (1, 'House Photo', 'ph_prop', 'Property/house photo'),

  -- Step 2: Cable from Pole
  (2, 'Cable from Pole', 'ph_pole', 'Cable running from pole'),
  (2, 'Cable from Pole', 'ph_outs', 'Outside cable view'),

  -- Step 3: Entry Outside
  (3, 'Entry Outside', 'ph_entry_out', 'Cable entry point outside'),
  (3, 'Entry Outside', 'ph_hm_ln', 'Home line entry'),

  -- Step 4: Entry Inside
  (4, 'Entry Inside', 'ph_entry_in', 'Cable entry point inside'),
  (4, 'Entry Inside', 'ph_hm_en', 'Home entry inside'),

  -- Step 5: Wall
  (5, 'Wall', 'ph_wall', 'Wall installation'),

  -- Step 6: ONT Back
  (6, 'ONT Back', 'ph_ont', 'ONT device'),
  (6, 'ONT Back', 'ph_ont_back', 'ONT back view'),
  (6, 'ONT Back', 'ph_drop', 'Drop cable'),
  (6, 'ONT Back', 'ph_cbl_r', 'Cable run'),
  (6, 'ONT Back', 'ph_bl', 'Backlight/ONT indicator'),

  -- Step 7: Power Meter
  (7, 'Power Meter', 'ph_powm', 'Power meter reading'),
  (7, 'Power Meter', 'ph_powm1', 'Power meter reading 1'),
  (7, 'Power Meter', 'ph_powm2', 'Power meter reading 2'),

  -- Step 8: Final Installation
  (8, 'Final Installation', 'ph_after', 'After installation'),
  (8, 'Final Installation', 'ph_final', 'Final installation view'),

  -- Step 9: Green Lights
  (9, 'Green Lights', 'ph_lights', 'ONT lights'),
  (9, 'Green Lights', 'ph_led', 'LED indicators'),

  -- Step 10: Signature
  (10, 'Signature', 'ph_sign2', 'Customer signature'),
  (10, 'Signature', 'ph_signature', 'Signature photo')
ON CONFLICT (photo_type) DO UPDATE SET
  step_number = EXCLUDED.step_number,
  step_label = EXCLUDED.step_label,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================
-- 3. Create indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_photo_step_mappings_step ON photo_step_mappings(step_number);
CREATE INDEX IF NOT EXISTS idx_photo_step_mappings_active ON photo_step_mappings(is_active) WHERE is_active = true;

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Photo Step Mappings Migration Complete ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Table created: photo_step_mappings';
    RAISE NOTICE 'Records inserted: 22 photo type mappings';
    RAISE NOTICE '';
    RAISE NOTICE 'This table can be used for:';
    RAISE NOTICE '  - Admin UI to manage photo type mappings';
    RAISE NOTICE '  - Future changes without code deployment';
    RAISE NOTICE '';
    RAISE NOTICE 'Source of truth: src/modules/activate/utils/stepMapper.ts';
    RAISE NOTICE '';
END$$;
