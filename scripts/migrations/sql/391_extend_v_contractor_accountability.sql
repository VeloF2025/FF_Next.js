-- Migration 391: extend v_contractor_accountability (Sprint E Track 4.4b)
-- (390 was taken by 390_pwa_support.sql; version chosen as max(file, DB) + 1.)
--
-- Adds two columns the live dashboards need so they can read contractor
-- accountability from the pure-custody live view instead of the legacy
-- `contractor_stock_accountability` table:
--   - contractor_name   (from contractors.company_name)
--   - unaccounted_value (the value analogue of the existing unaccounted_count)
--
-- The contractor-grain accountability APP surface (the contractor accountability
-- API + useContractorAccountability hook) is removed in the same track; the only
-- remaining readers are three dashboards (dashboard.ts blocked-count,
-- dashboardV2Service contractor-exposure, reconciliationService blocking-status),
-- repointed to this view in this PR.
--
-- The legacy `contractor_stock_accountability` TABLE itself is dropped later, in
-- the gated mig 387 cutover family (Track 4.5), once the two trigger functions
-- that still reference it (trg_emit_serial_event_on_{picking_done,return_disposition})
-- are retired/cleaned at cutover.
--
-- unaccounted_value mirrors the construction of unaccounted_count in
-- v_holder_accountability: per-holder (issued − consumed − returned − held),
-- summed over the contractor's holders. v_holder_accountability does not expose a
-- per-holder unaccounted_value, so it is computed inline here from its value cols.
--
-- Idempotent: CREATE OR REPLACE VIEW. CREATE OR REPLACE only permits APPENDING
-- columns (existing columns must keep the same name, order and type), so the nine
-- mig 384 columns are reproduced verbatim and in their original order, with
-- contractor_name + unaccounted_value appended at the end. Consumers select by
-- name, so the trailing position is irrelevant. No data change.

BEGIN;

CREATE OR REPLACE VIEW v_contractor_accountability AS
SELECT
  -- ── mig 384 columns, verbatim order (CREATE OR REPLACE constraint) ──────────
  h.contractor_id,
  SUM(va.issued_count)                    AS total_issued_count,
  SUM(va.consumed_count)                  AS total_consumed_count,
  SUM(va.returned_count)                  AS total_returned_count,
  SUM(va.held_count)                      AS current_held_count,
  SUM(va.held_value)                      AS current_held_value,
  SUM(va.unaccounted_count)               AS unaccounted_count,
  bool_or(va.is_blocked)                  AS is_blocked,
  SUM(va.pending_recovery_amount)         AS pending_recovery_amount,
  -- ── mig 390 additions (appended) ───────────────────────────────────────────
  c.company_name                          AS contractor_name,
  SUM(
    COALESCE(va.issued_value, 0)
    - COALESCE(va.consumed_value, 0)
    - COALESCE(va.returned_value, 0)
    - COALESCE(va.held_value, 0)
  )                                       AS unaccounted_value
FROM v_holder_accountability va
JOIN stock_holders h ON h.id = va.holder_id
LEFT JOIN contractors c ON c.id = h.contractor_id
WHERE h.contractor_id IS NOT NULL
GROUP BY h.contractor_id, c.company_name;

INSERT INTO migrations (version, name, executed_at)
VALUES ('391', 'extend_v_contractor_accountability', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
