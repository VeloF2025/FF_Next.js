-- ============================================================================
-- Data remediation: OES-only activations wrongly re-dated into "Installed"
-- ============================================================================
--
-- CONTEXT
--   The Activate dashboard "Installed (From WhatsApp)" count spiked this week
--   (e.g. 2026-07-15 showed 360, real ~190). Root cause: the internal reprocess
--   crons (retry-categorizations, refetch-missing-photos, admin/retry-failed)
--   re-invoke /api/activate/process-new-dr with no WhatsApp context. That path
--   defaulted a missing submitted_date to today and flipped is_oes_only=FALSE,
--   converting historic OES-only activations (never submitted via WhatsApp) into
--   "installed today" records.
--
--   The code fix (drRecordService.handleExistingUnified — guard on wa.waMessageId)
--   stops any NEW corruption. This script repairs the rows already corrupted.
--
-- ORDER OF OPERATIONS
--   1. Deploy the code fix FIRST. If you run this before the fix ships, the next
--      cron cycle will re-corrupt the same rows.
--   2. Run this script in DRY-RUN (default: it ends with ROLLBACK and only
--      prints before/after). Review the numbers.
--   3. To apply: change the final `ROLLBACK;` to `COMMIT;` and re-run.
--
-- TARGET SET (precise, conservative)
--   Rows that are: not OES-only now, have ZERO WhatsApp evidence
--   (wa_message_id / wa_received_at / whatsapp_submitted_at all NULL), exist in
--   oes_activations, and whose submitted_date was fabricated well after the row
--   was created (> 7 days). Correct end state: is_oes_only = TRUE (so they count
--   as Activated, never Installed) and submitted_date = NULL (drop the fake date).
-- ============================================================================

\set ON_ERROR_STOP on

-- ---- BEFORE: what will change -------------------------------------------------
\echo '=== BEFORE: target rows ==='
SELECT
  COUNT(*)                                        AS target_rows,
  COUNT(*) FILTER (WHERE feedback_sent = true)    AS also_marked_reviewed,
  MIN(created_at::date)                           AS oldest_created,
  MIN(submitted_date)                             AS earliest_faked_date,
  MAX(submitted_date)                             AS latest_faked_date
FROM dr_photo_unified_reviews
WHERE (is_oes_only = FALSE OR is_oes_only IS NULL)
  AND wa_message_id IS NULL
  AND wa_received_at IS NULL
  AND whatsapp_submitted_at IS NULL
  AND submitted_date IS NOT NULL
  AND submitted_date - created_at::date > 7
  AND drop_number IN (SELECT drop_number FROM oes_activations);

\echo '=== BEFORE: "Installed" per day for the affected window ==='
SELECT COALESCE(submitted_date, created_at::date) AS day, COUNT(*) AS installed
FROM dr_photo_unified_reviews
WHERE (is_oes_only = FALSE OR is_oes_only IS NULL)
  AND drop_number IN (SELECT drop_number FROM drops)
  AND COALESCE(project,'') NOT IN ('Marketing','Marketing Activations','Unknown')
  AND COALESCE(submitted_date, created_at::date) >= DATE '2026-07-13'
GROUP BY 1 ORDER BY 1;

BEGIN;

UPDATE dr_photo_unified_reviews
SET is_oes_only    = TRUE,
    submitted_date = NULL,
    updated_at     = NOW()
WHERE (is_oes_only = FALSE OR is_oes_only IS NULL)
  AND wa_message_id IS NULL
  AND wa_received_at IS NULL
  AND whatsapp_submitted_at IS NULL
  AND submitted_date IS NOT NULL
  AND submitted_date - created_at::date > 7
  AND drop_number IN (SELECT drop_number FROM oes_activations);

\echo '=== AFTER (in-transaction): "Installed" per day for the affected window ==='
SELECT COALESCE(submitted_date, created_at::date) AS day, COUNT(*) AS installed
FROM dr_photo_unified_reviews
WHERE (is_oes_only = FALSE OR is_oes_only IS NULL)
  AND drop_number IN (SELECT drop_number FROM drops)
  AND COALESCE(project,'') NOT IN ('Marketing','Marketing Activations','Unknown')
  AND COALESCE(submitted_date, created_at::date) >= DATE '2026-07-13'
GROUP BY 1 ORDER BY 1;

-- DRY-RUN default. Change to COMMIT to apply.
ROLLBACK;
