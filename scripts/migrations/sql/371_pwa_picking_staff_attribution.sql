-- Migration 371: PWA — stock_pickings.created_by_staff_id
--
-- Version 370 was claimed at 2026-05-22 08:45 by another session
-- (works_qa_rewrite_broken_photo_keys, PR #1729). This migration bumps to
-- 371 per `feedback_migration_version_collision` (pick from
-- `SELECT MAX(version) FROM migrations`, not `ls`).
--
-- Phase 4 of the Field Stock PWA plan needs per-stores-user attribution:
-- "show today's pickings created by THIS stores user." The current
-- stock_pickings table records who got the stock (technician_id) and
-- the stores-side identity is dropped on the floor by
-- pages/api/procurement/field-stock/pickings/index.ts. This migration
-- adds a nullable FK column so post-PWA pickings carry the creator's
-- staff_id; pre-PWA rows backfill as NULL (correct — they predate
-- per-stores-user attribution and should not appear in the new
-- /my/stores/today view).
--
-- Idempotent. Nullable so existing rows are valid without backfill.
-- FK is ON DELETE SET NULL so historical pickings survive staff churn.

-- ============================================================
-- SECTION 1: Column + FK
-- ============================================================

ALTER TABLE stock_pickings
    ADD COLUMN IF NOT EXISTS created_by_staff_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'stock_pickings_created_by_staff_id_fkey'
    ) THEN
        ALTER TABLE stock_pickings
            ADD CONSTRAINT stock_pickings_created_by_staff_id_fkey
            FOREIGN KEY (created_by_staff_id)
            REFERENCES staff(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================
-- SECTION 2: Supporting index for the /my/stores/today aggregator
-- ============================================================
-- The Phase 4 aggregator filters by (created_by_staff_id, created_at::date)
-- to find today's pickings for the current stores user. Partial index
-- excludes the NULL rows (all pre-PWA pickings) to stay narrow.

CREATE INDEX IF NOT EXISTS idx_stock_pickings_created_by_staff
    ON stock_pickings (created_by_staff_id, created_at DESC)
    WHERE created_by_staff_id IS NOT NULL;

-- ============================================================
-- SECTION 3: Record migration
-- ============================================================

INSERT INTO migrations (version, name, executed_at, success)
VALUES ('371', 'pwa_picking_staff_attribution', NOW(), true)
ON CONFLICT (version) DO NOTHING;
