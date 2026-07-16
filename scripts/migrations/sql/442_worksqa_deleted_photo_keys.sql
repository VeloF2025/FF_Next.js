-- scripts/migrations/sql/442_worksqa_deleted_photo_keys.sql
-- Works QA: soft-delete bin for pole photos.
--
-- Adds `deleted_photo_keys` to pole_qa_photos, mirroring the existing
-- `unassigned_photo_keys` array. Photos removed from the Unassigned bucket move
-- HERE (soft delete) instead of being dropped, so a mis-delete is recoverable
-- and the Unassigned grid stays uncluttered ("otherwise it gets too messy" —
-- Johan, WA 2026-07-16). Restore moves a key back to unassigned_photo_keys.
--
-- Expand-only / additive: existing code never reads this column, so applying it
-- ahead of the feature code is backward-compatible.

ALTER TABLE pole_qa_photos
  ADD COLUMN IF NOT EXISTS deleted_photo_keys TEXT[] NOT NULL DEFAULT '{}'::text[];
