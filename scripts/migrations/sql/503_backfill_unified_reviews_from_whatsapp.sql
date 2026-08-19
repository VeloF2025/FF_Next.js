-- Migration 503: fill dr_photo_unified_reviews.project from the WhatsApp
-- submission the DR came from, for rows `drops` could not resolve.
--
-- Data-only and idempotent: fills a NULL column with a value qa_photo_reviews
-- already holds. Re-running matches nothing (the IS NULL guard no longer holds)
-- rather than erroring. Touches no schema object.
--
-- NOT wrapped in BEGIN;/COMMIT; on purpose. scripts/run-pending-migrations.sh
-- applies this file as `psql -1 -c "\i <file>" -c "INSERT INTO
-- schema_migrations ..."`. Postgres does not nest transactions, so a COMMIT
-- inside the file ends psql's transaction early and lets the change commit
-- while its tracker row fails independently. Matches 467, 469, 471, 472, 473.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Migration 473 backfilled `project` from `drops` and explicitly left the rest
-- alone, on the reasoning that "the rest are not in `drops` at all, so the
-- stats queries already exclude them via `drop_number IN (SELECT drop_number
-- FROM drops)`". That exclusion turned out to be the bug, not the boundary.
--
-- On 2026-08-19 the THEMBIES Activations WhatsApp group posted 15 activations
-- for Themb'elihle. The Activate dashboard showed 10. DR3022005, DR3022046,
-- DR3022070, DR3022071 and DR3022079 are real submissions — photos, both
-- serials, a qa_photo_reviews row each — but the SOW import never loaded those
-- drop numbers, so `drops` has no row and the dashboard could not see them.
-- Etwatwa (20 submitted / 18 shown) and Thembisa POP 1 (51 / 50) under-reported
-- the same day for the same reason.
--
-- The read queries are fixed in the same PR to admit a DR that has a
-- qa_photo_reviews row even when `drops` does not. That alone is not enough:
-- these rows were created by ensure-data.ts, which resolved `project` from
-- `drops` only, so they carry NULL. An admitted row with a NULL project is not
-- discarded — the exclusion filter reads LOWER(COALESCE(project,'')) and ''
-- matches no entry — it is MISFILED: getProjectStats groups on
-- COALESCE(project,'Unknown'), so it lands under a project literally named
-- 'Unknown'. Verified on the live database 2026-08-19: with the gate fixed and
-- this migration NOT applied, Themb'elihle reads 10 and a separate 'Unknown'
-- row reads 5. This migration gives those rows the project their submission
-- already recorded, so the count lands where it belongs.
--
-- Measured on the live database 2026-08-19, before this migration:
--   235 unified rows absent from `drops`
--    33 of those with a qa_photo_reviews row
--    38 rows total with a NULL project and a submission that names one
--       (this migration's scope — a few are in `drops` but were never resolved)
--   202 with none — Velo Test (61), Mohadin (55), Lawley (51), Mamelodi (15),
--       Marketing Activations (4), Integration/Test Project (2), NULL (14).
--       Untouched here and still excluded by the read queries: no submission
--       stands behind them.
--
-- ── Scope guards ───────────────────────────────────────────────────────────
-- * `project IS NULL` — this migration can only turn NULL into a value, never
--   change one value into another. A project a human corrected on the unified
--   row survives untouched.
-- * `qa.project IS NOT NULL` appears in BOTH the EXISTS guard and the subquery.
--   Without it in the guard, a row whose only submission carries no project
--   matches the WHERE and gets NULL written over NULL — so the guard never stops
--   holding and every re-run touches it again. It is what makes this idempotent.
-- * Correlated scalar subqueries rather than UPDATE ... FROM: qa_photo_reviews
--   holds one row per submission and a resubmitted DR legitimately has several,
--   so the join form could match more than one and pick arbitrarily. ORDER BY
--   created_at DESC + LIMIT 1 takes the latest submission, deterministically.
-- * `submitted_date` is deliberately NOT backfilled, same as 473. It is NULL on
--   68 of these rows and the read queries already handle that via
--   COALESCE(submitted_date, created_at::DATE) (PR #2345) — for a WhatsApp
--   submission the unified row is created within seconds of the message, so the
--   two agree. Writing the column anyway would move 21 rows onto a different
--   reporting day, which is a change to historical numbers this fix does not
--   need and did not ask for.

UPDATE dr_photo_unified_reviews u
   SET project = (
         SELECT qa.project
           FROM qa_photo_reviews qa
          WHERE qa.drop_number = u.drop_number
            AND qa.project IS NOT NULL
          ORDER BY qa.created_at DESC
          LIMIT 1
       ),
       updated_at = NOW()
 WHERE u.project IS NULL
   AND EXISTS (
         SELECT 1
           FROM qa_photo_reviews qa
          WHERE qa.drop_number = u.drop_number
            AND qa.project IS NOT NULL
       );
