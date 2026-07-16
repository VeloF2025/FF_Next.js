-- Rollback for 442_worksqa_deleted_photo_keys.sql
-- Drops the soft-delete bin column. Any keys currently parked in
-- deleted_photo_keys are lost on rollback (the underlying MinIO blobs are not
-- touched — only the DB reference is removed).

ALTER TABLE pole_qa_photos
  DROP COLUMN IF EXISTS deleted_photo_keys;
