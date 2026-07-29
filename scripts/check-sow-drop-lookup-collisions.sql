-- Re-derives the measurements quoted in lookupSOWDrop's doc comment
-- (src/modules/noc/services/ticketEnrichmentService.ts).
--
-- Read-only. Safe to run against production.
--   psql "$DATABASE_URL" -f scripts/check-sow-drop-lookup-collisions.sql
--
-- Context: the lookup used to fall back to `drop_number LIKE '%<digits>%'` when
-- the exact match missed. That returned whichever unrelated drop the planner
-- reached first, which feeds the pole number, contractor, municipality,
-- PON/zone and GPS shown on a NOC ticket. Removed in PR #2296.
--
-- Run this before changing how the lookup matches.
--
-- Reading the output: ticket counts climb continuously as tickets are created,
-- so query 2's ticket_drs and exact_miss drift by a few every day and small
-- movement means nothing. The number that carries the argument is
-- legit_prefix_only_match: while it is 0, no substring or prefix-stripping
-- fallback can resolve anything the exact match missed, so any row such a
-- fallback returns belongs to a different drop. If it ever becomes non-zero,
-- rows have started arriving without the DR prefix and the lookup's fallback
-- (currently dormant) has become load-bearing — revisit the doc comment on
-- lookupSOWDrop at that point.

\echo '=== 1. sow_drops drop_number storage format ==='
-- 2026-07-29: 64,030 total, 64,030 prefixed, 0 bare, 0 untrimmed, 0 mixed-case.
-- The prefix-insensitive fallback in the lookup is dormant while bare = 0. It
-- is retained because onemap_properties holds 3,896 bare rows, so a bare-storing
-- import source is a demonstrated failure mode rather than a hypothetical.
SELECT count(*)                                                   AS total,
       count(*) FILTER (WHERE UPPER(drop_number) LIKE 'DR%')      AS prefixed,
       count(*) FILTER (WHERE UPPER(drop_number) NOT LIKE 'DR%')  AS bare,
       count(*) FILTER (WHERE drop_number <> TRIM(drop_number))   AS untrimmed,
       count(*) FILTER (WHERE drop_number <> UPPER(drop_number))  AS mixed_case
FROM sow_drops
WHERE drop_number IS NOT NULL;

\echo ''
\echo '=== 2. how the old substring fallback behaved on real ticket DR numbers ==='
-- 2026-07-29: ~4,140 ticket DRs, ~424 missing the exact match, the substring
-- form returning a row for 27 of them, and legit_prefix_only_match 0 — i.e. it
-- never once returned the right drop. The first two counts climb daily.
--
-- normalized mirrors normalizeDRNumber(): strip, uppercase, and prefix DR onto
-- a bare or D-prefixed number. Anything else (DR-LAW-A-045, "NO DR SUPPLIED")
-- passes through untouched, exactly as the TypeScript does.
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
-- 2026-07-29: DR173 matched 10,107 rows and DR185 matched 6,829 — truncated
-- ticket references are both the likeliest to miss the exact match and the
-- worst to resolve by substring.
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
-- prefixed and could not match a DR-prefixed row. Fixed in PR #2296.
-- 2026-07-29: 0 such values, so that defect was latent rather than live.
SELECT count(*) AS bare_numeric_ticket_drs
FROM (
  SELECT DISTINCT UPPER(TRIM(dr_number)) AS dr
  FROM maintenance_tickets
  WHERE dr_number IS NOT NULL AND TRIM(dr_number) <> ''
) s
WHERE dr !~ 'D';
