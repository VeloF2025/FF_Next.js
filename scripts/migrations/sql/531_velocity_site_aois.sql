-- 531_velocity_site_aois.sql
--
-- Standing site geometry for the Fleet operational monitor, derived from the
-- pole register instead of hand-drawn.
--
-- WHY THIS EXISTS
--
-- `fleet_project_operational_sites` requires exactly one geometry source per
-- site: an `fno_atlas_project_aois` polygon or a `fleet_authorized_locations`
-- circle. Only Lawley has a site today. Seeding the other seven live projects
-- needed a decision about where their geometry comes from, and the measurement
-- that settled it is in the PR body. In short:
--
--   * A circle is the wrong shape. The minimum bounding circle over Thembisa
--     POP 1's own on-site clock-ins is 971 km2 against a 1.88 km2 polygon —
--     it would call a driver "on site" anywhere in Ekurhuleni. Fitting the
--     circles tighter produces the opposite failure on the same sites.
--   * A hull drawn round 30 days of clock-ins is a snapshot. It covers no
--     street nobody has clocked in on yet, and it goes stale silently.
--   * `project_aois.aoi` is already each project's own convex hull over its
--     surveyed poles, rebuilt nightly by `refresh_project_aois()` (499/523).
--     Buffered 300 m it covers EVERY on-site clock-in measured across the six
--     projects with derivable geometry, and it self-maintains as poles land.
--
-- So the geometry is not new data. This migration copies a derived table into
-- the shape the Fleet monitor can consume, and adds the function that keeps
-- the copy honest.
--
-- WHY 300 m
--
-- The buffer closes the gap between "hull over pole positions" and "the work
-- area around those poles" — kerbs, yards, the far side of a street whose
-- poles are all on one side. Measured: of the trimmed on-site clock-ins,
-- the raw pole hull covers 301 of 325 and the 300 m buffer covers 324. The
-- one it misses is 312 m out. Themb'elihle is the case that forces the
-- buffer: 6 of 17 inside the raw hull, 17 of 17 at 300 m.
--
-- WHY A SEPARATE SOURCE ROW
--
-- The active-uniqueness index on `fno_atlas_project_aois` is
-- (source_id, site_code, area_name) WHERE retired_at IS NULL. The 29 active
-- rows already in the table came from the OneMap ingest under source
-- `fibreflow://onemap_properties`. Writing under that source would let a
-- refresh here collide with — or silently overwrite — an ingest row. A source
-- of our own makes the two sets disjoint by construction, and makes
-- "everything this function owns" expressible as a single predicate, which is
-- exactly what the stale-row sweep below needs.
--
-- WHY STALE ROWS ARE SOMETIMES RETIRED RATHER THAN DELETED
--
-- `fleet_project_operational_sites.project_aoi_id` is a plain FK with NO
-- ACTION. Deleting a row a site references does not orphan it — it raises
-- 23503 and aborts the whole refresh. That is not hypothetical: linking these
-- AOIs to operational sites is the entire point of creating them, so the
-- referenced case is the NORMAL case. A referenced stale row is therefore
-- retired instead. Every Fleet consumer already joins
-- `retired_at IS NULL` (evidenceQueries, rosterQueries, mapOverlayService,
-- projectSiteQueries), so retiring removes it from evidence just as a delete
-- would, without breaking the reference or the nightly job.
--
-- Unreferenced stale rows are deleted outright, as designed.

-- ---------------------------------------------------------------------------
-- (a) The source row.
-- ---------------------------------------------------------------------------
-- `source_url` is the table's unique key, so it — not the display name — is
-- what the function resolves on and what makes this INSERT repeatable.
INSERT INTO fno_atlas_sources (
  source_name, source_url, source_type, access_method, terms_notes, priority, is_active
) VALUES (
  'Velocity project site AOIs',
  'fibreflow://project_aois',
  'manual',
  'manual_upload',
  'Internal Velocity site geometry: each project''s pole-register convex hull (project_aois.aoi, refreshed by refresh_project_aois()) buffered 300 m. Derived internal data — never official FNO-published coverage. Maintained by refresh_velocity_site_aois(); do not hand-edit rows under this source.',
  10,
  TRUE
)
ON CONFLICT (source_url) DO UPDATE
  SET source_name   = EXCLUDED.source_name,
      source_type   = EXCLUDED.source_type,
      access_method = EXCLUDED.access_method,
      terms_notes   = EXCLUDED.terms_notes,
      priority      = EXCLUDED.priority,
      is_active     = EXCLUDED.is_active,
      updated_at    = NOW();

-- ---------------------------------------------------------------------------
-- (b) The refresh.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_velocity_site_aois()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
  swept integer;
  src_id uuid;
  -- The buffer is a data decision measured against the clock-in record (see
  -- the header), not a tuning knob. Re-measure before changing it.
  buffer_m CONSTANT float8 := 300.0;
  v_source_url CONSTANT text := 'fibreflow://project_aois';
BEGIN
  SELECT id INTO src_id FROM fno_atlas_sources WHERE source_url = v_source_url;
  IF src_id IS NULL THEN
    RAISE EXCEPTION
      'refresh_velocity_site_aois: no fno_atlas_sources row for %, so every row would be written under a NULL source and share one uniqueness slot with the ingest',
      v_source_url;
  END IF;

  WITH eligible AS (
    SELECT
      pa.project_id,
      pr.project_code::text AS project_code,
      pr.project_name::text AS project_name,
      pa.pole_count,
      -- pa.aoi is geography(Geometry,4326): ST_Buffer on geography takes
      -- METRES, which is the whole reason the buffer is not applied in
      -- degrees. The hull is convex (or a line/point for a collinear
      -- project), so its buffer is convex and needs no ST_MakeValid.
      ST_Multi(ST_Buffer(pa.aoi, buffer_m)::geometry)::geometry(MultiPolygon, 4326) AS geom
    FROM project_aois pa
    JOIN projects pr ON pr.id = pa.project_id
    -- Only `ok` hulls. 523 scores each hull for outlier distortion; a
    -- `distorted` one is 63x too large and would call half a province
    -- on-site, and `suspect`/`unassessed` are not evidence of a usable shape
    -- either.
    WHERE pa.aoi_status = 'ok'
  ), upserted AS (
    INSERT INTO fno_atlas_project_aois (
      source_id, site_code, area_name, area_kind, point_count, confidence,
      geom, raw_properties, last_seen_at, updated_at
    )
    SELECT
      src_id,
      -- site_code is the project UUID, not project_code: it is the only
      -- identifier that cannot be edited out from under an operational site.
      e.project_id::text,
      e.project_name,
      'velocity_site_aoi',
      e.pole_count,
      -- `ok` is the strongest statement 523's scoring makes about a hull.
      'high',
      e.geom,
      jsonb_build_object(
        'derivedFrom', 'project_aois',
        'bufferMetres', buffer_m,
        'projectId', e.project_id,
        'projectCode', e.project_code,
        'label', 'Velocity site AOI - derived from the pole register, not official FNO-published coverage'
      ),
      NOW(), NOW()
    FROM eligible e
    -- The index is partial, so its predicate has to be reproduced here or
    -- Postgres cannot pick it as the arbiter.
    ON CONFLICT (source_id, site_code, area_name) WHERE retired_at IS NULL
    DO UPDATE SET
      geom           = EXCLUDED.geom,
      point_count    = EXCLUDED.point_count,
      confidence     = EXCLUDED.confidence,
      raw_properties = EXCLUDED.raw_properties,
      last_seen_at   = NOW(),
      updated_at     = NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO n FROM upserted;

  -- Stale sweep. A row is stale when this source has no matching CURRENT
  -- (site_code, area_name) pair — which covers a project losing `ok` status,
  -- losing its poles, being deleted, AND being renamed (the rename writes a
  -- new row under the new area_name, and this removes the old one).
  --
  -- Retire-or-delete is decided per row and written once: both branches read
  -- the same `stale` CTE, so the predicate cannot drift between them, and
  -- they touch disjoint rows so the two writes cannot conflict.
  WITH stale AS (
    SELECT
      a.id,
      EXISTS (
        SELECT 1 FROM fleet_project_operational_sites s WHERE s.project_aoi_id = a.id
      ) AS referenced
    FROM fno_atlas_project_aois a
    WHERE a.source_id = src_id
      AND a.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM project_aois pa
        JOIN projects pr ON pr.id = pa.project_id
        WHERE pa.aoi_status = 'ok'
          AND pa.project_id::text = a.site_code
          AND pr.project_name::text = a.area_name
      )
  ), retired AS (
    UPDATE fno_atlas_project_aois a
       SET retired_at = NOW(), updated_at = NOW()
      FROM stale
     WHERE a.id = stale.id AND stale.referenced
    RETURNING a.id
  ), deleted AS (
    DELETE FROM fno_atlas_project_aois a
     USING stale
     WHERE a.id = stale.id AND NOT stale.referenced
    RETURNING a.id
  )
  -- A data-modifying WITH still needs its result consumed, or neither branch
  -- runs. The count also names what happened for anyone reading the log at
  -- DEBUG; the return value stays "rows written", which is what the cron
  -- reports.
  SELECT COUNT(*) INTO swept
    FROM (SELECT id FROM retired UNION ALL SELECT id FROM deleted) x;
  RAISE DEBUG 'refresh_velocity_site_aois: % written, % swept', n, swept;

  RETURN n;
END $$;

COMMENT ON FUNCTION refresh_velocity_site_aois() IS
  'Mirrors every ok project_aois hull into fno_atlas_project_aois under source fibreflow://project_aois, buffered 300 m, as the standing site geometry for the Fleet operational monitor. Returns the number of AOIs written. Safe to run repeatedly. Rows whose project no longer has an ok hull are deleted, or retired when an operational site references them.';

-- ---------------------------------------------------------------------------
-- (c) Grants.
-- ---------------------------------------------------------------------------
-- The function is SECURITY INVOKER, and the nightly cron connects as
-- fibreflow_user — so the caller's own privileges are what run the writes.
-- Production already holds all of these; re-granting is a no-op, and stating
-- them here is what makes a fresh database work.
GRANT SELECT, INSERT, UPDATE ON fno_atlas_sources TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON fno_atlas_project_aois TO fibreflow_user;
GRANT SELECT ON project_aois, projects, fleet_project_operational_sites TO fibreflow_user;
GRANT EXECUTE ON FUNCTION refresh_velocity_site_aois() TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- (d) Populate immediately, so the geometry exists the moment this lands
--     rather than at the next 03:15 cron.
-- ---------------------------------------------------------------------------
SELECT refresh_velocity_site_aois();

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('531_velocity_site_aois.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
