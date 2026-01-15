-- Migration: 047c_unique_constraints.sql
-- PRD: PRD-047-project-import-system
-- Description: Add unique constraints to enable proper upsert operations
-- Date: 2026-01-15
-- Target: drops, poles, fibre_segments tables

-- drops: Unique on project_id + dr_number for upsert (if not exists)
-- Note: drops may already have drops_project_id_dr_number_key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drops_project_dr_unique'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drops_project_id_dr_number_key'
  ) THEN
    ALTER TABLE drops ADD CONSTRAINT drops_project_dr_unique
      UNIQUE (project_id, dr_number);
    RAISE NOTICE 'Added unique constraint to drops';
  ELSE
    RAISE NOTICE 'Unique constraint already exists on drops';
  END IF;
END $$;

-- poles: Unique on project_id + pole_number for upsert (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poles_project_pole_unique'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poles_project_id_pole_number_key'
  ) THEN
    ALTER TABLE poles ADD CONSTRAINT poles_project_pole_unique
      UNIQUE (project_id, pole_number);
    RAISE NOTICE 'Added unique constraint to poles';
  ELSE
    RAISE NOTICE 'Unique constraint already exists on poles';
  END IF;
END $$;

-- fibre_segments: Unique on project_id + segment_id for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fibre_segments_project_segment_unique'
  ) THEN
    ALTER TABLE fibre_segments ADD CONSTRAINT fibre_segments_project_segment_unique
      UNIQUE (project_id, segment_id);
    RAISE NOTICE 'Added unique constraint to fibre_segments';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'fibre_segments table does not exist, skipping constraint';
END $$;

-- Verification query (run after migration)
-- SELECT conname, conrelid::regclass
-- FROM pg_constraint
-- WHERE conrelid::regclass::text IN ('drops', 'poles', 'fibre_segments')
-- AND contype = 'u';
