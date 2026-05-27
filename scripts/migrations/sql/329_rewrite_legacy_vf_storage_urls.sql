-- Migration 329: rewrite legacy https://vf.fibreflow.app/... → /storage/...
--
-- Background: vf.fibreflow.app was retired 2026-03-11 (per
-- docs/INFRASTRUCTURE.md). Every URL on that hostname now 301-redirects
-- to app.fibreflow.app, which doesn't have routes for /staff/photos,
-- /staff/documents, /procurement/..., /snags/..., etc — every one of
-- those URLs ends up at the Next.js app shell instead of the file.
--
-- The files themselves still live in VF Storage at the same paths, but
-- the URL stored in the DB references the dead hostname. Browsers see
-- broken images everywhere photos are rendered (StaffDetail Photo
-- Verification, Snag photos, fleet receipts, etc).
--
-- Fix: rewrite every URL of the form 'https://vf.fibreflow.app/<path>'
-- to '/storage/<path>'. Nginx already routes /storage/* → port 8091
-- where the file is actually served.
--
-- Rows affected (snapshot 2026-04-25):
--   contractor_documents.file_url:               20
--   document_cross_validations.po_document_url:   1
--   fleet_check_photos.storage_service_url:       2
--   fleet_fuel_transactions.receipt_photo_url:   21
--   fleet_fuel_transactions.odometer_photo_url:  20
--   fleet_license_disc.document_url:              1
--   maintenance_verification_steps.photo_url:    13
--   staff.id_photo_url:                           1
--   staff.profile_photo_url:                      3
--   procurement_documents.file_url:             990
--   project_documents.file_url:                   5
--   snag_photos.photo_url:                     3885
--   snag_reports.source_pdf_url:                  1
--   client_purchase_orders.source_document_url:   2
--   pipeline_approval_documents.file_url:      5466
--   staff_documents.file_url:                    50
--   maintenance_attachments.file_url:           479
--   maintenance_attachments.storage_url:        479
--   odoo_documents.file_url:                    121
--   asset_documents.file_url:                     1
-- Total: ~11,560 rows
--
-- Idempotent: only matches LIKE 'https://vf.fibreflow.app/%'. Re-running
-- after the rewrite is a no-op.

BEGIN;

-- staff
UPDATE staff
SET id_photo_url = REPLACE(id_photo_url, 'https://vf.fibreflow.app/', '/storage/'),
    updated_at = NOW()
WHERE id_photo_url LIKE 'https://vf.fibreflow.app/%';

UPDATE staff
SET profile_photo_url = REPLACE(profile_photo_url, 'https://vf.fibreflow.app/', '/storage/'),
    updated_at = NOW()
WHERE profile_photo_url LIKE 'https://vf.fibreflow.app/%';

-- staff_documents
UPDATE staff_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

-- contractor_documents
UPDATE contractor_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

-- fleet_check_photos
UPDATE fleet_check_photos
SET storage_service_url = REPLACE(storage_service_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE storage_service_url LIKE 'https://vf.fibreflow.app/%';

-- fleet_fuel_transactions (two columns)
UPDATE fleet_fuel_transactions
SET receipt_photo_url = REPLACE(receipt_photo_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE receipt_photo_url LIKE 'https://vf.fibreflow.app/%';

UPDATE fleet_fuel_transactions
SET odometer_photo_url = REPLACE(odometer_photo_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE odometer_photo_url LIKE 'https://vf.fibreflow.app/%';

-- fleet_license_disc
UPDATE fleet_license_disc
SET document_url = REPLACE(document_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE document_url LIKE 'https://vf.fibreflow.app/%';

-- maintenance_verification_steps
UPDATE maintenance_verification_steps
SET photo_url = REPLACE(photo_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE photo_url LIKE 'https://vf.fibreflow.app/%';

-- maintenance_attachments (two columns)
UPDATE maintenance_attachments
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

UPDATE maintenance_attachments
SET storage_url = REPLACE(storage_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE storage_url LIKE 'https://vf.fibreflow.app/%';

-- snag_photos (largest single column — 3885 rows)
UPDATE snag_photos
SET photo_url = REPLACE(photo_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE photo_url LIKE 'https://vf.fibreflow.app/%';

-- snag_reports
UPDATE snag_reports
SET source_pdf_url = REPLACE(source_pdf_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE source_pdf_url LIKE 'https://vf.fibreflow.app/%';

-- procurement_documents (990 rows)
UPDATE procurement_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

-- pipeline_approval_documents (largest — 5466 rows)
UPDATE pipeline_approval_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

-- project_documents
UPDATE project_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

-- client_purchase_orders
UPDATE client_purchase_orders
SET source_document_url = REPLACE(source_document_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE source_document_url LIKE 'https://vf.fibreflow.app/%';

-- document_cross_validations
UPDATE document_cross_validations
SET po_document_url = REPLACE(po_document_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE po_document_url LIKE 'https://vf.fibreflow.app/%';

-- odoo_documents
UPDATE odoo_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

-- asset_documents
UPDATE asset_documents
SET file_url = REPLACE(file_url, 'https://vf.fibreflow.app/', '/storage/')
WHERE file_url LIKE 'https://vf.fibreflow.app/%';

COMMIT;

-- Sanity check (run separately if needed):
--   SELECT 'staff.profile_photo_url' AS col,
--          COUNT(*) FILTER (WHERE profile_photo_url LIKE 'https://vf.%') AS legacy_left,
--          COUNT(*) FILTER (WHERE profile_photo_url LIKE '/storage/%')   AS rewritten
--   FROM staff;
