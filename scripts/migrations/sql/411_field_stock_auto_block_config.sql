-- Migration 411: field-stock accountability — auto-block policy config
-- (version = max(DB max 410, file max 410) + 1.)
--
-- Tier 3.2 of the Stores Accountability rollout. Adds ONE single-row config table
-- that drives the threshold-based holder auto-block (issue-time guard + nightly
-- sweep). Nothing existing is touched (lowest-risk extension shape).
--
--   stock_accountability_config — one policy row (CHECK id = 1 enforces singleton).
--     auto_block_enabled    — master switch. FALSE by default: NO holder is ever
--                             auto-blocked until an admin deliberately enables the
--                             policy AND sets thresholds. Hard-block is high-impact
--                             (refuses stock issuance), so it ships OFF.
--     aged_count_threshold  — block a holder when their count of `aged_no_evidence`
--                             serials (from v_holder_stock_exceptions: held 30+ days
--                             with no OES/WA activation evidence) reaches this value.
--     aged_value_threshold  — OR block when the Rand value of those aged serials
--                             (SUM of stock_items.standard_cost) reaches this value.
--
-- The guard reads this row; if the row is missing the service falls back to the
-- DEFAULT_AUTO_BLOCK_POLICY constant (also disabled). Either threshold tripping
-- blocks (OR semantics) — see src/.../services/autoBlockPolicy.ts.
--
-- Tuning is via UPDATE on this row (population is near-zero today; an admin UI is a
-- documented Tier 3.x follow-up). To ARM the policy after deploy, e.g.:
--   UPDATE stock_accountability_config
--      SET auto_block_enabled = true, aged_count_threshold = 3,
--          aged_value_threshold = 5000, updated_by = 'hein', updated_at = NOW()
--    WHERE id = 1;

BEGIN;

CREATE TABLE IF NOT EXISTS stock_accountability_config (
  id                   integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_block_enabled   boolean     NOT NULL DEFAULT false,
  aged_count_threshold integer     NOT NULL DEFAULT 3    CHECK (aged_count_threshold >= 1),
  aged_value_threshold numeric(14,2) NOT NULL DEFAULT 5000 CHECK (aged_value_threshold >= 0),
  updated_at           timestamptz NOT NULL DEFAULT NOW(),
  updated_by           varchar(255)
);

-- Seed the singleton row (disabled). Idempotent: re-running the migration leaves an
-- existing (possibly admin-tuned) row untouched.
INSERT INTO stock_accountability_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO migrations (version, name, executed_at)
VALUES ('411', 'field_stock_auto_block_config', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
