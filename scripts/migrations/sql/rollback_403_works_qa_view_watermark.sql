-- Rollback for migration 403: Works QA "since I last opened" watermark.
-- Drops the per-user watermark table and the photo_key index it added.
-- Safe to re-run. The index is a pure performance add on qfield_photo_validations;
-- dropping it does not affect correctness of any other query.

DROP TABLE IF EXISTS works_qa_view_watermark;
DROP INDEX IF EXISTS idx_qpv_photo_key;
