-- Migration 477: conformed project dimension
--
-- `project` is free text in every source table, so one site appears under several
-- spellings. Grouping happens in the database, so the alias map needs a SQL twin of
-- src/modules/metrics/dimensions/canonical.ts. tests/migrations/477_conformed_
-- project_dimension.test.ts asserts the two produce identical output for every
-- sample and for every project name actually present in the database — if they ever
-- drift, that test fails.
--
-- IMMUTABLE so it can be indexed and grouped efficiently. That is also why the
-- vocabulary is inlined rather than read from `projects`: an IMMUTABLE function may
-- not read tables. A function that did would have to be STABLE, and could not back
-- an index.
--
-- ⚠️ TEM and TEM-3 are DIFFERENT projects — Thembisa POP 1 and POP 3. They read
-- like a base name and a variant, so the intuitive move is to fold TEM-3 into TEM;
-- that would merge two separate POPs into one number. Resolved from data, not shape:
--   TEM   -> Thembisa POP 1 (157/170 rows)
--   TEM-3 -> Thembisa POP 3 (42/42)
--   ETW-2 -> Etwatwa
--
-- ⚠️ Add no alias you have not resolved by joining it through drops -> projects.
--
-- NOTE: no BEGIN/COMMIT — the migration runner manages the transaction.
--
-- NLNH confidence: HIGH — every mapping measured against the live database 2026-08-02.

CREATE OR REPLACE FUNCTION canonical_project(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE lower(btrim(coalesce(raw, '')))
    WHEN ''      THEN 'Unknown'

    -- Verified aliases.
    WHEN 'tem'   THEN 'Thembisa POP 1'
    WHEN 'tem-3' THEN 'Thembisa POP 3'
    WHEN 'etw-2' THEN 'Etwatwa'

    -- Canonical names, so a case variant folds to the canonical spelling instead
    -- of forming a second bucket for the same site. Each maps to itself, so none
    -- of these can mis-group anything.
    WHEN 'botshabelo'             THEN 'Botshabelo'
    WHEN 'cradock'                THEN 'Cradock'
    WHEN 'etwatwa'                THEN 'Etwatwa'
    WHEN 'general / equipment'    THEN 'General / Equipment'
    WHEN 'grabouw'                THEN 'Grabouw'
    WHEN 'lawley'                 THEN 'Lawley'
    WHEN 'mahikeng'               THEN 'Mahikeng'
    WHEN 'mamelodi'               THEN 'Mamelodi'
    WHEN 'middelburg'             THEN 'Middelburg'
    WHEN 'mohadin'                THEN 'Mohadin'
    WHEN 'phalaborwa - ben farm'  THEN 'Phalaborwa - Ben Farm'
    WHEN 'phalabrowa - namakgale' THEN 'Phalabrowa - Namakgale'
    WHEN 'themb''elihle'          THEN 'Themb''elihle'
    WHEN 'thembisa pop 1'         THEN 'Thembisa POP 1'
    WHEN 'thembisa pop 2'         THEN 'Thembisa POP 2'
    WHEN 'thembisa pop 3'         THEN 'Thembisa POP 3'
    WHEN 'tonga'                  THEN 'Tonga'

    -- Unmapped values pass through TRIMMED but otherwise unchanged. Dropping them
    -- or bucketing them into 'Unknown' would silently shrink totals; an unfamiliar
    -- label in the output is visible and fixable.
    ELSE btrim(raw)
  END;
$fn$;

COMMENT ON FUNCTION canonical_project(text) IS
  'Folds free-text project names to the projects.project_name vocabulary. Mirrors canonicalProject() in src/modules/metrics/dimensions/canonical.ts; parity is enforced by tests/migrations/477_conformed_project_dimension.test.ts.';
