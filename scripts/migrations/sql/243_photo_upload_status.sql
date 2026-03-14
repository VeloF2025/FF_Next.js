-- Migration 243: Add upload_status to construction_qa_photos
--
-- Tracks whether a QField photo binary has been confirmed in MinIO.
-- Photos ingested from GPKG metadata may reference files not yet uploaded
-- by the field device. This column prevents VLM classification of ghost records.
--
-- Values:
--   available       — file confirmed in MinIO (versioned path exists)
--   pending_upload  — ingested from GPKG but MinIO check has not found it yet
--   missing         — pending_upload record older than 7 days, still not found

ALTER TABLE construction_qa_photos
    ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'available'
        CHECK (upload_status IN ('available', 'pending_upload', 'missing'));

-- Mark all existing qfield records that still have unversioned keys as pending_upload.
-- Unversioned keys look like: projects/{uuid}/files/DCIM/filename.jpg  (no /v2 segment)
-- Versioned keys look like:   projects/{uuid}/files/DCIM/filename.jpg/v20260310120500-7bc5005f
UPDATE construction_qa_photos
SET
    upload_status = 'pending_upload',
    updated_at    = NOW()
WHERE
    source = 'qfield'
    AND storage_key NOT LIKE '%/v2%'
    AND upload_status = 'available';

-- Index to make the recheck cron efficient
CREATE INDEX IF NOT EXISTS idx_cqp_upload_status
    ON construction_qa_photos (upload_status)
    WHERE upload_status IN ('pending_upload', 'missing');
