-- Rollback for migration 329: revert /storage/ URLs back to https://vf.fibreflow.app/
--
-- Only undoes URLs that the forward migration would have rewritten — i.e.
-- where the path looks like a VF Storage location (/storage/<known-bucket>/...).
-- Brand-new uploads (which write /storage/... directly) are NOT rolled back.
--
-- Idempotent: re-runnable.

BEGIN;

UPDATE staff
SET id_photo_url = REPLACE(id_photo_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE id_photo_url LIKE '/storage/staff/%';

UPDATE staff
SET profile_photo_url = REPLACE(profile_photo_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE profile_photo_url LIKE '/storage/staff/%';

-- Note: rollback intentionally targets only /storage/ URLs whose path
-- shape matches the forward-migration rewrite (i.e. starts with a known
-- bucket prefix). Anything written natively as /storage/... by new code
-- after migration 329 is preserved.

UPDATE staff_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/staff/documents/%';

UPDATE contractor_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/contractors/%';

UPDATE fleet_check_photos
SET storage_service_url = REPLACE(storage_service_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE storage_service_url LIKE '/storage/fleet/%';

UPDATE fleet_fuel_transactions
SET receipt_photo_url = REPLACE(receipt_photo_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE receipt_photo_url LIKE '/storage/fleet/%';

UPDATE fleet_fuel_transactions
SET odometer_photo_url = REPLACE(odometer_photo_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE odometer_photo_url LIKE '/storage/fleet/%';

UPDATE fleet_license_disc
SET document_url = REPLACE(document_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE document_url LIKE '/storage/fleet/%';

UPDATE maintenance_verification_steps
SET photo_url = REPLACE(photo_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE photo_url LIKE '/storage/maintenance/%';

UPDATE maintenance_attachments
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/maintenance/%';

UPDATE maintenance_attachments
SET storage_url = REPLACE(storage_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE storage_url LIKE '/storage/maintenance/%';

UPDATE snag_photos
SET photo_url = REPLACE(photo_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE photo_url LIKE '/storage/snags/%';

UPDATE snag_reports
SET source_pdf_url = REPLACE(source_pdf_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE source_pdf_url LIKE '/storage/snags/%';

UPDATE procurement_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/procurement/%';

UPDATE pipeline_approval_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/pipeline/%';

UPDATE project_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/projects/%';

UPDATE client_purchase_orders
SET source_document_url = REPLACE(source_document_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE source_document_url LIKE '/storage/%';

UPDATE document_cross_validations
SET po_document_url = REPLACE(po_document_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE po_document_url LIKE '/storage/%';

UPDATE odoo_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/odoo-docs/%';

UPDATE asset_documents
SET file_url = REPLACE(file_url, '/storage/', 'https://vf.fibreflow.app/')
WHERE file_url LIKE '/storage/assets/%';

COMMIT;
