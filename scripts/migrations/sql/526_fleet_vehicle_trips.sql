-- 526_fleet_vehicle_trips.sql
--
-- Durable, continuously-built trips from the position stream.
--
-- Distinct from fleet_gps_trips, which belongs to the manual investigation flow: that table's
-- job_id is NOT NULL with ON DELETE CASCADE to fleet_gps_jobs, so deleting an investigation would
-- silently delete continuous trips, and its gps_points jsonb inlines every point of every trip,
-- which continuously would duplicate the whole position stream forever. The investigation flow is
-- untouched by this migration.
--
-- The invariant this schema exists to protect: a trip that never saw its ignition-off must never
-- be indistinguishable from one that did. Trackers go silent -- a 42.6 hour gap between
-- consecutive positions is present in the current data -- and a phantom long trip silently
-- corrupts utilisation, average trip length and cost-per-km while looking entirely plausible.
-- So close_reason is NOT NULL with a closed value set, and counts_toward_metrics is GENERATED
-- from it rather than being a column anyone can set. A caller cannot mark a timed-out trip as
-- metric-eligible, because the database computes that column and refuses writes to it.
--
-- Additive only: two new tables, no ALTER against anything existing.

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_vehicle_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  tracker_id UUID REFERENCES fleet_vehicle_trackers(id) ON DELETE SET NULL,
  provider VARCHAR(20),

  -- Ignition on is the trip's identity; ignition off is absent while it is open.
  ignition_on_at TIMESTAMPTZ NOT NULL,
  ignition_off_at TIMESTAMPTZ,

  on_lat NUMERIC(10,7),
  on_lon NUMERIC(10,7),
  off_lat NUMERIC(10,7),
  off_lon NUMERIC(10,7),

  -- Reverse-geocoded LOCALITY -- "city, municipal district, province", not a street address. The
  -- shared reverseGeocode is tuned for South Africa and returns those three fields only; widening
  -- it would change a contract the parking and attendance features rely on.
  --
  -- Filled asynchronously by a throttled resolver at <= 1 request/second, never inline:
  -- Nominatim's acceptable-use policy forbids systematic bulk querying, and the geocoder shares
  -- one cache with parking compliance, so a bulk pattern here would take that feature down too.
  -- NULL means "not resolved yet", never "nowhere".
  on_location_text TEXT,
  off_location_text TEXT,

  -- Nearest known internal place and how far it was. Cheap, exact, no external dependency --
  -- this is the half of "where" that always works.
  --
  -- `kind` is required alongside the id because the id can come from two different tables
  -- (fleet_vehicle_parking_locations or project_aois); a bare UUID would not say which, and there
  -- is deliberately no FK for the same reason. `label` is a SNAPSHOT: parking locations are
  -- superseded over time, so resolving the name later would silently change what a historical
  -- trip appears to say.
  on_nearest_place_id UUID,
  on_nearest_place_kind TEXT,
  on_nearest_place_label TEXT,
  on_nearest_place_distance_m NUMERIC(10,1),
  off_nearest_place_id UUID,
  off_nearest_place_kind TEXT,
  off_nearest_place_label TEXT,
  off_nearest_place_distance_m NUMERIC(10,1),

  duration_seconds BIGINT,
  moving_seconds BIGINT,
  idle_seconds BIGINT,

  distance_km NUMERIC(10,2),
  max_speed_kph NUMERIC(6,2),
  start_odometer_km NUMERIC(12,2),
  end_odometer_km NUMERIC(12,2),
  position_count INTEGER NOT NULL DEFAULT 0,

  -- How the trip ended. 'open' is still accumulating; 'timeout' means the tracker went silent and
  -- the trip was closed at its LAST KNOWN position, never at now().
  close_reason TEXT NOT NULL,

  -- GENERATED, not assignable: only a trip that genuinely ended on an ignition-off may be
  -- averaged into utilisation or cost-per-km. The others are retained and countable as a
  -- data-quality signal. A confidently wrong number is worse than a visibly missing one.
  counts_toward_metrics BOOLEAN GENERATED ALWAYS AS (close_reason = 'ignition_off') STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The idempotency key. Re-running the builder over the same window updates a trip in place
  -- rather than duplicating it.
  CONSTRAINT fleet_vehicle_trips_identity UNIQUE (vehicle_id, ignition_on_at),

  CONSTRAINT fleet_vehicle_trips_close_reason_check
    CHECK (close_reason IN ('ignition_off', 'timeout', 'open')),

  -- An open trip has no end, and a closed one must have one. These are the same fact, so the
  -- schema states it once and refuses any row where the two disagree.
  CONSTRAINT fleet_vehicle_trips_open_has_no_end
    CHECK ((ignition_off_at IS NULL) = (close_reason = 'open')),

  CONSTRAINT fleet_vehicle_trips_time_order
    CHECK (ignition_off_at IS NULL OR ignition_off_at >= ignition_on_at),

  CONSTRAINT fleet_vehicle_trips_nonnegative CHECK (
    (duration_seconds IS NULL OR duration_seconds >= 0)
    AND (moving_seconds IS NULL OR moving_seconds >= 0)
    AND (idle_seconds IS NULL OR idle_seconds >= 0)
    AND (distance_km IS NULL OR distance_km >= 0)
    AND (max_speed_kph IS NULL OR max_speed_kph >= 0)
    AND position_count >= 0
  ),

  -- Time inside a trip cannot exceed the trip. Catches a segmenter that double-counts a position
  -- into both the moving and idle buckets.
  CONSTRAINT fleet_vehicle_trips_parts_within_whole CHECK (
    duration_seconds IS NULL
    OR COALESCE(moving_seconds, 0) + COALESCE(idle_seconds, 0) <= duration_seconds
  ),

  -- An odometer cannot run backwards within one trip.
  CONSTRAINT fleet_vehicle_trips_odometer_order CHECK (
    start_odometer_km IS NULL OR end_odometer_km IS NULL OR end_odometer_km >= start_odometer_km
  ),

  -- A distance without a place it happened is a measurement we cannot check.
  CONSTRAINT fleet_vehicle_trips_start_position_paired
    CHECK ((on_lat IS NULL) = (on_lon IS NULL)),
  CONSTRAINT fleet_vehicle_trips_end_position_paired
    CHECK ((off_lat IS NULL) = (off_lon IS NULL)),

  CONSTRAINT fleet_vehicle_trips_lat_range CHECK (
    (on_lat IS NULL OR on_lat BETWEEN -90 AND 90)
    AND (off_lat IS NULL OR off_lat BETWEEN -90 AND 90)
  ),
  CONSTRAINT fleet_vehicle_trips_place_kind CHECK (
    (on_nearest_place_kind IS NULL OR on_nearest_place_kind IN ('parking', 'project_aoi'))
    AND (off_nearest_place_kind IS NULL OR off_nearest_place_kind IN ('parking', 'project_aoi'))
  ),

  -- An id without its kind is unresolvable, and a kind without an id names nothing.
  CONSTRAINT fleet_vehicle_trips_place_paired CHECK (
    (on_nearest_place_id IS NULL) = (on_nearest_place_kind IS NULL)
    AND (off_nearest_place_id IS NULL) = (off_nearest_place_kind IS NULL)
  ),

  CONSTRAINT fleet_vehicle_trips_place_distance_nonnegative CHECK (
    (on_nearest_place_distance_m IS NULL OR on_nearest_place_distance_m >= 0)
    AND (off_nearest_place_distance_m IS NULL OR off_nearest_place_distance_m >= 0)
  ),

  CONSTRAINT fleet_vehicle_trips_lon_range CHECK (
    (on_lon IS NULL OR on_lon BETWEEN -180 AND 180)
    AND (off_lon IS NULL OR off_lon BETWEEN -180 AND 180)
  )
);

-- The read pattern: one vehicle over a date range, newest first.
CREATE INDEX IF NOT EXISTS ix_fleet_vehicle_trips_vehicle_time
  ON fleet_vehicle_trips (vehicle_id, ignition_on_at DESC);

-- Fleet-wide reporting over a period.
CREATE INDEX IF NOT EXISTS ix_fleet_vehicle_trips_time
  ON fleet_vehicle_trips (ignition_on_at DESC);

-- At most ONE open trip per vehicle, enforced rather than assumed. A vehicle cannot be on two
-- journeys at once, and the builder loads "the" open trip to continue it -- if two ever existed
-- that load would silently pick one and the other would be orphaned mid-journey, never closed and
-- never counted. UNIQUE makes that unrepresentable instead of merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_vehicle_trips_one_open_per_vehicle
  ON fleet_vehicle_trips (vehicle_id) WHERE close_reason = 'open';

-- The address resolver's work queue: trips still awaiting a street address.
CREATE INDEX IF NOT EXISTS ix_fleet_vehicle_trips_unresolved
  ON fleet_vehicle_trips (ignition_on_at DESC)
  WHERE on_location_text IS NULL OR off_location_text IS NULL;

COMMENT ON TABLE fleet_vehicle_trips IS
  'Continuously-built vehicle trips segmented on ignition transitions in fleet_vehicle_positions. '
  'Separate from fleet_gps_trips, which belongs to the manual investigation upload flow.';
COMMENT ON COLUMN fleet_vehicle_trips.close_reason IS
  'ignition_off = genuine end. timeout = tracker went silent, closed at the LAST KNOWN position. '
  'open = still accumulating. Only ignition_off trips are metric-eligible.';
COMMENT ON COLUMN fleet_vehicle_trips.counts_toward_metrics IS
  'GENERATED from close_reason and therefore not assignable by a caller.';

-- ---------------------------------------------------------------------------
-- Build watermarks
-- ---------------------------------------------------------------------------
-- Without this the builder rescans the entire position table on every run. One row per vehicle,
-- holding the newest position already folded into a trip.
CREATE TABLE IF NOT EXISTS fleet_trip_build_watermarks (
  vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  last_position_at TIMESTAMPTZ,
  last_built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  positions_processed BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fleet_trip_build_watermarks_processed_nonnegative
    CHECK (positions_processed >= 0)
);

COMMENT ON TABLE fleet_trip_build_watermarks IS
  'Per-vehicle high-water mark for incremental trip building.';

-- ---------------------------------------------------------------------------
-- Grants (mirrors the pattern used by 518 for the application role)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_vehicle_trips TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_trip_build_watermarks TO fibreflow_user;
