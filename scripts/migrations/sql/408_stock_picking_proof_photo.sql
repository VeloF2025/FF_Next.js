-- 408: photo proof for non-serial stock issues from the /my/stores PWA.
-- One photo per picking (spec 2026-06-11-stores-pwa-vlm-and-nonserial-design.md).
-- proof_photo_key: VF Storage key  e.g. stores/picking-proof/<staffId>__<uuid>.jpg
-- proof_photo_url: public path     e.g. /storage/stores/picking-proof/<file>
-- Nullable: serial pickings never set them. No backfill (table near-empty).

ALTER TABLE stock_pickings
  ADD COLUMN IF NOT EXISTS proof_photo_key text,
  ADD COLUMN IF NOT EXISTS proof_photo_url text;
