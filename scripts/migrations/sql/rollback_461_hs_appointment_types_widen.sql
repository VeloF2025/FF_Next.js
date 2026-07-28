-- Rollback 461: Widen hs_appointment_letters.letter_type
--
-- Restores the original 4-value CHECK constraint from 455. Will FAIL if any
-- row already uses one of the 18 widened types (letter_type IN (...) CHECK
-- violation on the narrower constraint) -- if that happens, migrate or delete
-- those rows first; this rollback intentionally does not silently drop data.

BEGIN;

ALTER TABLE hs_appointment_letters DROP CONSTRAINT IF EXISTS hs_appointment_letters_type_check;

ALTER TABLE hs_appointment_letters ADD CONSTRAINT hs_appointment_letters_type_check
  CHECK (letter_type IN ('s16_2','s8_1','construction_supervisor','annexure_3'));

DELETE FROM schema_migrations WHERE filename = '461_hs_appointment_types_widen.sql';

COMMIT;
