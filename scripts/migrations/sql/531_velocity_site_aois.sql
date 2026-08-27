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
-- IDENTITY: ONE ROW PER PROJECT, FOREVER
--
-- A site AOI's identity is (velocity source, project). NOT the project name.
--
-- This is the whole reason for the extra unique index below. The table's own
-- active-uniqueness index is (source_id, site_code, area_name) WHERE
-- retired_at IS NULL, so with `area_name` in the key a renamed project would
-- INSERT a second row rather than update the first — and an operational site
-- linked to the original would be left pointing at a row this function then
-- retires. `evidenceQueries`, `rosterQueries`, `mapOverlayService` and
-- `projectSiteQueries` all join `retired_at IS NULL`, so the site's geometry
-- would silently resolve to nothing and the monitor would stop judging that
-- site without saying so. The same orphaning happened on any
-- distorted -> ok round trip.
--
-- So `site_code` is the project UUID (stable across renames, and the only
-- identifier that cannot be edited out from under a live site), and the
-- refresh keys on it: a rename UPDATES `area_name` in place, and a project
-- returning to `ok` REVIVES its existing row rather than inserting a new one.
-- The linked site keeps pointing at the same id through both.
--
-- WHY A SEPARATE SOURCE ROW, WITH A PINNED ID
--
-- The 29 active rows already in the table came from the OneMap ingest under
-- `fibreflow://onemap_properties`. Writing under that source would let a
-- refresh here collide with — or silently overwrite — an ingest row. A source
-- of our own makes the two sets disjoint by construction.
--
-- Its UUID is pinned as a literal because the uniqueness index below is
-- scoped to it. A table-wide (source_id, site_code) index would have been
-- simpler, but it would also silently forbid the OneMap ingest from holding
-- two live rows for one site_code under different area_names — a shape its
-- own (source_id, site_code, area_name) index explicitly supports. Narrowing
-- another writer's contract as a side effect of this migration is not on.
--
-- The function asserts the resolved source id matches the literal, so if this
-- INSERT ever lands on a pre-existing row with a different id the refresh
-- fails loudly instead of writing rows outside its own index.
--
-- WHY STALE ROWS ARE RETIRED, NEVER DELETED
--
-- `fleet_project_operational_sites.project_aoi_id` is a plain FK with NO
-- ACTION. Deleting a row a site references does not orphan it — it raises
-- 23503 and aborts the whole refresh. Deciding delete-vs-retire from an
-- EXISTS check does not fix that: the check and the delete see different
-- snapshots, so a site inserted between them still aborts the run.
--
-- The sweep therefore RETIRES, always. There is no FK race and no snapshot
-- window. A retired row is inert — every Fleet consumer filters
-- `retired_at IS NULL` — and one row per project is not worth a delete.
-- Revival (above) is what stops retirement accumulating garbage.

-- ---------------------------------------------------------------------------
-- (a) The source row, with a pinned id.
-- ---------------------------------------------------------------------------
-- `source_url` is the table's unique key, so it — not the display name — is
-- what makes this INSERT repeatable.
INSERT INTO fno_atlas_sources (
  id, source_name, source_url, source_type, access_method, terms_notes, priority, is_active
) VALUES (
  'e0f1c0de-0000-4000-8000-000000000531',
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

-- One live row per project under this source, and nothing else constrained.
-- Verified against production before writing this: no (source_id, site_code)
-- pair is duplicated among live rows anywhere in the table, and this source
-- has no rows at all yet, so the index builds clean.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fno_atlas_velocity_site_aois_active_site
  ON fno_atlas_project_aois (site_code)
  WHERE retired_at IS NULL
    AND source_id = 'e0f1c0de-0000-4000-8000-000000000531'::uuid;

COMMENT ON INDEX ux_fno_atlas_velocity_site_aois_active_site IS
  'Identity for Velocity site AOIs: one live row per project (site_code = project UUID) under source fibreflow://project_aois. Deliberately scoped to that source so the OneMap ingest keeps its own (source_id, site_code, area_name) identity.';

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
  revived integer;
  src_id uuid;
  -- The buffer is a data decision measured against the clock-in record (see
  -- the header), not a tuning knob. Re-measure before changing it.
  buffer_m CONSTANT float8 := 300.0;
  v_source_url CONSTANT text := 'fibreflow://project_aois';
  -- Must equal the literal in the uniqueness index predicate above. The
  -- assertion below is what makes a mismatch loud instead of silent.
  v_source_id CONSTANT uuid := 'e0f1c0de-0000-4000-8000-000000000531';
BEGIN
  SELECT id INTO src_id FROM fno_atlas_sources WHERE source_url = v_source_url;
  IF src_id IS NULL THEN
    RAISE EXCEPTION
      'refresh_velocity_site_aois: no fno_atlas_sources row for %, so every row would be written under a NULL source and share one uniqueness slot with the ingest',
      v_source_url;
  END IF;
  IF src_id <> v_source_id THEN
    RAISE EXCEPTION
      'refresh_velocity_site_aois: source % resolved to % but the uniqueness index is scoped to %; rows would be written outside their own index',
      v_source_url, src_id, v_source_id;
  END IF;

  -- Step 1 — REVIVE. A project that has returned to `ok` gets its EXISTING
  -- row back, so an operational site linked to it keeps working. Without this
  -- the upsert below would insert a second row (a retired row is not in the
  -- partial index) and strand the link on the retired one.
  UPDATE fno_atlas_project_aois a
     SET retired_at = NULL,
         updated_at = NOW()
   WHERE a.source_id = src_id
     AND a.retired_at IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM project_aois pa
       JOIN projects pr ON pr.id = pa.project_id
       WHERE pa.aoi_status = 'ok'
         AND pa.project_id::text = a.site_code
     );
  GET DIAGNOSTICS revived = ROW_COUNT;

  -- Step 2 — UPSERT on the project's identity.
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
    -- The arbiter is the identity index: site_code alone, scoped to this
    -- source. Its predicate has to be reproduced verbatim or Postgres cannot
    -- infer it. `area_name` is UPDATED here, never part of the key — that is
    -- what makes a rename an update instead of an orphaning insert.
    ON CONFLICT (site_code)
      WHERE retired_at IS NULL
        AND source_id = 'e0f1c0de-0000-4000-8000-000000000531'::uuid
    DO UPDATE SET
      area_name      = EXCLUDED.area_name,
      geom           = EXCLUDED.geom,
      point_count    = EXCLUDED.point_count,
      confidence     = EXCLUDED.confidence,
      raw_properties = EXCLUDED.raw_properties,
      last_seen_at   = NOW(),
      updated_at     = NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO n FROM upserted;

  -- Step 3 — RETIRE, always. Never DELETE: see the header. A row is stale
  -- when its project no longer has an `ok` hull — which covers losing `ok`,
  -- losing its poles, and the project being deleted. A rename is NOT stale;
  -- step 2 already updated its name in place.
  UPDATE fno_atlas_project_aois a
     SET retired_at = NOW(),
         updated_at = NOW()
   WHERE a.source_id = src_id
     AND a.retired_at IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM project_aois pa
       JOIN projects pr ON pr.id = pa.project_id
       WHERE pa.aoi_status = 'ok'
         AND pa.project_id::text = a.site_code
     );
  GET DIAGNOSTICS swept = ROW_COUNT;

  RAISE DEBUG 'refresh_velocity_site_aois: % written, % revived, % retired', n, revived, swept;

  RETURN n;
END $$;

COMMENT ON FUNCTION refresh_velocity_site_aois() IS
  'Mirrors every ok project_aois hull into fno_atlas_project_aois under source fibreflow://project_aois, buffered 300 m, as the standing site geometry for the Fleet operational monitor. One live row per project, keyed on site_code = project UUID: a rename updates it in place and a return to ok revives it, so a linked operational site never loses its geometry. Returns the number of AOIs written. Safe to run repeatedly. Rows whose project no longer has an ok hull are retired, never deleted.';

-- ---------------------------------------------------------------------------
-- (c) Grants.
-- ---------------------------------------------------------------------------
-- The function is SECURITY INVOKER, and the nightly cron connects as
-- fibreflow_user — so the caller's own privileges are what run the writes.
-- Production already holds the table grants; re-granting is a no-op, and
-- stating them here is what makes a fresh database work.
GRANT SELECT, INSERT, UPDATE ON fno_atlas_sources TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON fno_atlas_project_aois TO fibreflow_user;
GRANT SELECT ON project_aois, projects, fleet_project_operational_sites TO fibreflow_user;

-- EXECUTE defaults to PUBLIC on a new function, which would make the grant
-- below decorative. Revoking first is what makes it load-bearing — and what
-- makes the SET ROLE test able to fail.
REVOKE ALL ON FUNCTION refresh_velocity_site_aois() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_velocity_site_aois() TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- (d) Populate immediately, so the geometry exists the moment this lands
--     rather than at the next 03:15 cron.
-- ---------------------------------------------------------------------------
SELECT refresh_velocity_site_aois();

-- ---------------------------------------------------------------------------
-- (e) Repoint existing operational sites off the OneMap ingest.
-- ---------------------------------------------------------------------------
-- One site exists today: Lawley, pointing at the OneMap AOI. Measured against
-- production on 2026-08-27: the velocity Lawley AOI is 10.786 km2, the OneMap
-- one 7.715 km2, ST_Covers is true and the OneMap area falling outside the
-- velocity polygon is 0.000000 km2 — it is strictly contained, so nowhere
-- that counts as on-site today stops counting.
--
-- The ST_Covers guard is in the statement rather than in this comment on
-- purpose: it makes the migration verify the containment itself rather than
-- trust a number measured once, and it is what keeps the UPDATE safe for any
-- other site that acquires an ingest AOI before this lands.
UPDATE fleet_project_operational_sites s
   SET project_aoi_id = v.id,
       updated_at = NOW()
  FROM fno_atlas_project_aois v,
       fno_atlas_project_aois prev
 WHERE prev.id = s.project_aoi_id
   AND prev.source_id IS DISTINCT FROM 'e0f1c0de-0000-4000-8000-000000000531'::uuid
   AND v.source_id = 'e0f1c0de-0000-4000-8000-000000000531'::uuid
   AND v.retired_at IS NULL
   AND v.site_code = s.project_id::text
   AND ST_Covers(v.geom, prev.geom);

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('531_velocity_site_aois.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
