-- Evidence behind lookupSOWDrop's matching strategy
-- (src/modules/noc/services/ticketEnrichmentService.ts).
--
-- Read-only: no writes, no DDL, no locks.
--   psql "$DATABASE_URL" -f scripts/check-sow-drop-lookup-collisions.sql
--
-- Takes ~40s, most of it sequential LIKE comparisons over the 64k-row
-- sow_drops table. It takes no locks and cannot block anything, but dev and
-- production share one database instance, so prefer to run it outside
-- 08:00-17:00 SAST rather than adding load during the working day.
--
-- Context: the lookup used to fall back to `drop_number LIKE '%<digits>%'` when
-- the exact match missed. That returned whichever unrelated drop the planner
-- reached first, which feeds the pole number, contractor, municipality,
-- PON/zone and GPS shown on a NOC ticket. Removed in PR #2296.
--
-- Run this before changing how the lookup matches.
--
-- ----------------------------------------------------------------------------
-- REFERENCE OUTPUT — 2026-07-29. This block is the only place any of these
-- figures is written down; the TypeScript doc comment deliberately carries none
-- of them, so there is nothing to drift out of sync with. Update this block, and
-- only this block, when a re-run legitimately supersedes it.
--
--   1. sow_drops format         64030 total / 64030 prefixed / 0 bare
--                               / 0 untrimmed / 0 mixed_case
--   2. old fallback behaviour   4141 ticket_drs / 424 exact_miss
--                               / 25 fallback_ambiguous / 27 returned_a_row
--                               / 0 legit_prefix_only_match / 27 wrong_row
--   3. worst collisions         DR173 -> 10107, DR185 -> 6829, rest <= 10
--   4. bare-numeric ticket DRs  0
--   5. onemap_properties        103955 total / 3896 bare
--
-- Reading the output: ticket_drs and exact_miss climb continuously as tickets
-- are created, so a few days' drift in those two means nothing.
--
-- The number that carries the argument is legit_prefix_only_match. While it is
-- 0, no substring or prefix-stripping fallback can resolve anything the exact
-- match missed, so any row such a fallback returns belongs to a different drop.
-- If it ever becomes non-zero, rows have started arriving without the DR prefix
-- and the lookup's currently-dormant fallback has become load-bearing.
-- ----------------------------------------------------------------------------

\echo '=== 1. sow_drops drop_number storage format ==='
-- While bare = 0 the lookup's prefix-insensitive fallback is dormant: every
-- stored value already carries the prefix the exact match looks for.
SELECT count(*)                                                   AS total,
       count(*) FILTER (WHERE UPPER(drop_number) LIKE 'DR%')      AS prefixed,
       count(*) FILTER (WHERE UPPER(drop_number) NOT LIKE 'DR%')  AS bare,
       count(*) FILTER (WHERE drop_number <> TRIM(drop_number))   AS untrimmed,
       count(*) FILTER (WHERE drop_number <> UPPER(drop_number))  AS mixed_case
FROM sow_drops
WHERE drop_number IS NOT NULL;

\echo ''
\echo '=== 2. how the old substring fallback behaved on real ticket DR numbers ==='
-- legit_prefix_only_match is the count of misses a *correct* prefix-stripping
-- fallback would have rescued; wrong_row_returned is the count the old
-- substring form answered with some other drop entirely.
--
-- normalized mirrors normalizeDRNumber(): trim, uppercase, then prefix DR onto
-- a number written bare or with a leading D and/or R (1853428, D1853428,
-- R1853428, DR1853428 all become DR1853428). Anything else — DR-LAW-A-045,
-- "NO DR SUPPLIED" — passes through untouched, exactly as the TypeScript does.
WITH tdr AS (
  SELECT DISTINCT
    CASE WHEN UPPER(TRIM(dr_number)) ~ '^D?R?[0-9]+$'
         THEN 'DR' || (regexp_match(UPPER(TRIM(dr_number)), '^D?R?([0-9]+)$'))[1]
         ELSE UPPER(TRIM(dr_number)) END AS normalized
  FROM maintenance_tickets
  WHERE dr_number IS NOT NULL AND TRIM(dr_number) <> ''
),
sd AS (
  SELECT UPPER(drop_number) AS up,
         regexp_replace(UPPER(drop_number), '^DR', '') AS stripped
  FROM sow_drops
  WHERE drop_number IS NOT NULL
),
miss AS (
  SELECT t.normalized, regexp_replace(t.normalized, '^DR', '') AS numeric_part
  FROM tdr t
  WHERE NOT EXISTS (SELECT 1 FROM sd WHERE sd.up = t.normalized)
),
res AS (
  SELECT m.normalized,
         m.numeric_part,
         (SELECT count(*) FROM sd WHERE sd.up LIKE '%' || m.numeric_part || '%') AS like_hits,
         (SELECT count(*) FROM sd WHERE sd.stripped = m.numeric_part)            AS stripped_exact_hits
  FROM miss m
)
SELECT (SELECT count(*) FROM tdr)                                        AS ticket_drs,
       count(*)                                                          AS exact_miss,
       count(*) FILTER (WHERE like_hits > 1)                             AS fallback_ambiguous,
       count(*) FILTER (WHERE like_hits > 0)                             AS fallback_returned_a_row,
       count(*) FILTER (WHERE stripped_exact_hits > 0)                   AS legit_prefix_only_match,
       count(*) FILTER (WHERE like_hits > 0 AND stripped_exact_hits = 0) AS wrong_row_returned
FROM res;

\echo ''
\echo '=== 3. worst individual collisions ==='
-- Truncated ticket references are both the likeliest to miss the exact match
-- and the worst to resolve by substring: the shorter the digit run, the more
-- drops contain it.
SELECT s.normalized,
       (SELECT count(*) FROM sow_drops d
        WHERE d.drop_number LIKE '%' || regexp_replace(s.normalized, '^DR', '') || '%') AS like_hits
FROM (
  SELECT DISTINCT
    CASE WHEN UPPER(TRIM(dr_number)) ~ '^D?R?[0-9]+$'
         THEN 'DR' || (regexp_match(UPPER(TRIM(dr_number)), '^D?R?([0-9]+)$'))[1]
         ELSE UPPER(TRIM(dr_number)) END AS normalized
  FROM maintenance_tickets
  WHERE dr_number IS NOT NULL AND TRIM(dr_number) <> ''
) s
WHERE NOT EXISTS (
  SELECT 1 FROM sow_drops d WHERE UPPER(d.drop_number) = s.normalized
)
ORDER BY like_hits DESC
LIMIT 10;

\echo ''
\echo '=== 4. bare-numeric ticket DR numbers ==='
-- normalizeDRNumber used to require a literal D, so a bare "1853428" was never
-- prefixed and could not match a DR-prefixed row. Fixed in PR #2296. While this
-- is 0 that defect was latent rather than live.
SELECT count(*) AS bare_numeric_ticket_drs
FROM (
  SELECT DISTINCT UPPER(TRIM(dr_number)) AS dr
  FROM maintenance_tickets
  WHERE dr_number IS NOT NULL AND TRIM(dr_number) <> ''
) s
WHERE dr !~ 'D';

\echo ''
\echo '=== 5. why the dormant fallback is kept: the sibling table DID drift ==='
-- lookupOneMapDrop queries onemap_properties with the same prefix-insensitive
-- fallback, and there it is load-bearing. A non-zero `bare` here is the whole
-- argument for keeping the equivalent fallback in lookupSOWDrop despite query 1
-- showing 0: storing drop numbers without the prefix is a demonstrated
-- behaviour of an import source in this system, not a hypothetical.
SELECT count(*)                                                  AS total,
       count(*) FILTER (WHERE UPPER(drop_number) NOT LIKE 'DR%') AS bare
FROM onemap_properties
WHERE drop_number IS NOT NULL;
