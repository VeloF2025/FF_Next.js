-- Rollback for migration 328_staff_receipts.sql
--
-- WARNING: dropping the staff_receipts table loses all captured receipt
-- data + the structured OCR extractions. The original images remain in
-- VF Storage but become orphan blobs.

DELETE FROM role_permissions WHERE permission_key IN ('receipts', 'receipts.review');
DELETE FROM access_permissions WHERE key IN ('receipts', 'receipts.review');

DROP INDEX IF EXISTS idx_staff_receipts_project;
DROP INDEX IF EXISTS idx_staff_receipts_status_review;
DROP INDEX IF EXISTS idx_staff_receipts_staff_recent;
DROP TABLE IF EXISTS staff_receipts;
