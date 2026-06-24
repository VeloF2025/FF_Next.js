-- Rollback 423: drop the per-GPKG pending photo counter.
-- Safe: extract-gpkg-photos.py only reads/writes this column; without it the extractor
-- reverts to the pure version-delta skip (the prior behaviour).
ALTER TABLE qfield_gpkg_sync_state DROP COLUMN IF EXISTS pending_count;
