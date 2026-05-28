-- Rollback 388: drop the civil step 8 ("Pole Label") slot column.
-- Any photos placed in civil_step_08_key are lost on rollback; the source
-- photos remain in qfield_photo_validations and can be re-synced.

ALTER TABLE pole_qa_photos
  DROP COLUMN IF EXISTS civil_step_08_key;

DELETE FROM migrations WHERE version = '388';
