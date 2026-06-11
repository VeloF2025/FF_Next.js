-- Rollback 408: drop the proof-photo columns.
ALTER TABLE stock_pickings
  DROP COLUMN IF EXISTS proof_photo_key,
  DROP COLUMN IF EXISTS proof_photo_url;
