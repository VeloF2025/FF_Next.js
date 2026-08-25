-- 528_fleet_vehicle_daily_stats.sql
--
-- Per-vehicle, per-SAST-calendar-day rollup of the position stream, plus the incremental build
-- watermark that feeds it, plus one additive column on fleet_vehicle_positions.
--
-- Everything here is expand-only: two new tables and one new nullable column. Nothing is dropped,
-- retyped or rewritten, so it is safe to apply against the shared dev+production database while
-- the current code is running.
--
-- ## Why the coverage flags are columns and not a comment
--
-- Eighteen tracked vehicles sit behind four feeds whose cadence spans three orders of magnitude:
-- cartrack/velocity is event-driven at a median 8-second gap (~1,169 fixes/vehicle-day), while
-- netstar/europcar and ituran/avis deliver about ten snapshot fixes a day and netstar supplies no
-- odometer at all. A statistic that is honest for the first feed is a fabrication for the others,
-- and the fabrication is invisible -- it is a plausible number in the same column.
--
-- So the schema refuses to store the numbers a feed cannot support. A vehicle-day that does not
-- assert ignition cannot carry ignition or idle seconds; a vehicle-day that reports neither
-- g-force nor provider event types cannot carry harsh-driving counts. Those are CHECKs rather
-- than conventions because a convention is exactly what fails silently.
--
-- ## coverage_gforce is measured per vehicle-day, never inferred from the provider
--
-- Six of the seven cartrack/velocity vehicles report linear_g and lateral_g as CONSTANT ZERO --
-- one distinct value across 22k-60k rows each -- rather than null. A coverage test written as
-- "linear_g IS NOT NULL", or as "provider = cartrack", passes for all seven and is wrong for six.
-- The flag therefore means "a fix in THIS vehicle-day carried a non-zero g reading".
--
-- ## coverage_provider_events, and why the harsh-count CHECK names it
--
-- Cartrack's firmware computes harshness itself and emits HARSH_BRAKING / HARSH_CORNERING in
-- event_description -- and it does so on precisely the firmware family whose g columns are
-- structurally zero, including HARSH_CORNERING at 95-129 km/h with lin=0, lat=0. Those are real
-- events the g columns cannot see at all. Gating harsh counts on coverage_gforce alone would make
-- the only reliable harsh source unstorable, so the CHECK admits either evidence base.

-- ---------------------------------------------------------------------------
-- Provider event vocabulary on the raw position stream
-- ---------------------------------------------------------------------------
-- Cartrack's GET /vehicles/events returns 57 fields; the ingest keeps 14 and threw this one away
-- on every fix. It carries a 14-value vocabulary (PERIODIC_EVENT, IGNITION_ON/OFF,
-- MOTION_START/END, IDLING_START/CONTINUE/END, GPS_LOCK/LOST, SPEEDING_START/END, HARSH_BRAKING,
-- HARSH_CORNERING) measured over 55,009 events across 8 vehicles and 7 days on 2026-08-25.
--
-- Nullable and additive: netstar and ituran expose no equivalent field and write NULL, and the
-- currently-deployed ingest does not name the column at all, so this is safe to apply live.
--
-- Deliberately un-indexed. The only reader is the day fold and the detectors, both of which
-- already scan a vehicle-and-time window through ix_fleet_vehicle_positions_vehicle_time; an
-- index on a column that is NULL for eleven of eighteen vehicles would cost writes and serve
-- nothing.
ALTER TABLE fleet_vehicle_positions ADD COLUMN IF NOT EXISTS provider_event_type TEXT;

COMMENT ON COLUMN fleet_vehicle_positions.provider_event_type IS
  'Provider-native event vocabulary, verbatim. Cartrack event_description; NULL for netstar and '
  'ituran, which expose no equivalent field. Not an enum: a provider may add a value at any time.';

-- ---------------------------------------------------------------------------
-- Vehicle-day stats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fleet_vehicle_daily_stats (
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

  -- The SAST calendar day, not a UTC day. SAST is UTC+2 with no DST, so a fix at 22:00:00Z
  -- already belongs to the NEXT work_date.
  work_date DATE NOT NULL,

  ignition_seconds BIGINT NOT NULL DEFAULT 0,
  moving_seconds BIGINT NOT NULL DEFAULT 0,
  idle_seconds BIGINT NOT NULL DEFAULT 0,

  -- Ignition time that could be measured but not classified: the engine was running and the
  -- interval was short enough to attribute, yet the fix closing it reported no speed and carried
  -- no motion event.
  --
  -- In practice this is a cartrack/velocity-only residual, and small. It is NOT where a coarse
  -- feed's unknown time goes: a feed whose fixes are hours apart fails coverage_ignition
  -- entirely, so its ignition_seconds is 0 and this is 0 with it. The row says "we could not see"
  -- through the coverage flags rather than by parking a large number here.
  --
  -- GENERATED, so it cannot drift from the three columns it derives from and no caller can assert
  -- a split the feed's cadence does not support.
  unattributed_seconds BIGINT GENERATED ALWAYS AS (
    GREATEST(ignition_seconds - moving_seconds - idle_seconds, 0)
  ) STORED,

  distance_km NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_speed_kph NUMERIC(6,2),
  -- Rising edges of the provider's own is_speeding flag: one per stretch, not one per fix.
  speeding_events INTEGER NOT NULL DEFAULT 0,
  -- Duration, and it shares the fold's attribution ceiling with ignition time: only an interval
  -- short enough to attribute honestly contributes. So 0 seconds beside a non-zero
  -- speeding_events is not "a speeding event of no duration" -- it is a feed too coarse to
  -- measure one, and coverage_ignition = false is the signal that says so.
  speeding_seconds BIGINT NOT NULL DEFAULT 0,
  harsh_brake_events INTEGER NOT NULL DEFAULT 0,
  harsh_accel_events INTEGER NOT NULL DEFAULT 0,
  harsh_corner_events INTEGER NOT NULL DEFAULT 0,

  first_ignition_at TIMESTAMPTZ,
  last_ignition_at TIMESTAMPTZ,

  position_count INTEGER NOT NULL DEFAULT 0,

  -- The LARGEST unobserved stretch in the day, not the sum of them. A sum answers "how much of
  -- the day was unobserved", which for a snapshot feed is almost all of it and therefore says
  -- nothing; the largest stretch answers "did this tracker go dark", which is the question a
  -- coverage flag and a lost-contact detector both need.
  --
  -- "Unobserved" includes the window's HEAD and TAIL, not only the gaps between fixes. A vehicle
  -- whose first fix lands at 23:00 SAST has 23 hours nobody looked at and an eight-second largest
  -- inter-fix gap; counting only the gaps would let that day report complete coverage off forty
  -- minutes of evidence.
  tracker_silence_seconds BIGINT NOT NULL DEFAULT 0,

  -- The feed that contributed the most fixes to this day. A vehicle can change tracker mid-day,
  -- which is what coverage_granularity = 'mixed' records.
  provider VARCHAR(20),
  account_ref VARCHAR(50),

  coverage_granularity TEXT NOT NULL,
  -- Ignition seconds are MEASURABLE here: the feed asserts ignition on at least 90% of the day's
  -- fixes AND the day's median inter-fix gap is inside the attribution ceiling. The second half
  -- is what stops a two-hour feed publishing 0 / 0 / 0 as though it had observed a parked day.
  coverage_ignition BOOLEAN NOT NULL,
  coverage_gforce BOOLEAN NOT NULL,
  coverage_provider_events BOOLEAN NOT NULL,
  -- Observed as well as this feed can manage: enough fixes for its cadence, and no silence beyond
  -- its allowance -- where "silence" includes the hours at each END of the window, not just the
  -- gaps between fixes. A day whose first fix lands at 23:00 has 23 unobserved hours and an
  -- eight-second largest gap, and without the edges it would report complete off forty minutes of
  -- evidence.
  coverage_complete BOOLEAN NOT NULL,

  -- The newest recorded_at folded into this row. Its absence is what makes a zero-position row
  -- distinguishable from a row that was never built.
  source_watermark TIMESTAMPTZ,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The idempotency key. Re-folding a day updates its row in place rather than duplicating it.
  PRIMARY KEY (vehicle_id, work_date),

  CONSTRAINT fleet_vehicle_daily_stats_nonnegative CHECK (
    ignition_seconds >= 0
    AND moving_seconds >= 0
    AND idle_seconds >= 0
    AND distance_km >= 0
    AND (max_speed_kph IS NULL OR max_speed_kph >= 0)
    AND speeding_events >= 0
    AND speeding_seconds >= 0
    AND harsh_brake_events >= 0
    AND harsh_accel_events >= 0
    AND harsh_corner_events >= 0
    AND position_count >= 0
    AND tracker_silence_seconds >= 0
  ),

  -- Time inside the day's ignition-on period cannot exceed it. Catches a fold that books one
  -- sampling interval into both the moving and the idle bucket -- the same class of defect
  -- fleet_vehicle_trips_parts_within_whole exists to catch on the trips table.
  CONSTRAINT fleet_vehicle_daily_stats_parts_within_whole CHECK (
    moving_seconds + idle_seconds <= ignition_seconds
  ),

  CONSTRAINT fleet_vehicle_daily_stats_ignition_order CHECK (
    last_ignition_at IS NULL OR first_ignition_at IS NULL OR last_ignition_at >= first_ignition_at
  ),

  -- Both instants come from the same scan, so one without the other is a fold that lost track of
  -- itself rather than a day with a first ignition and no last.
  CONSTRAINT fleet_vehicle_daily_stats_ignition_paired CHECK (
    (first_ignition_at IS NULL) = (last_ignition_at IS NULL)
  ),

  CONSTRAINT fleet_vehicle_daily_stats_granularity CHECK (
    coverage_granularity IN ('history', 'snapshot', 'mixed', 'none')
  ),

  -- A feed that reports neither a non-zero g reading nor a provider event vocabulary has no way
  -- to observe harsh driving, so it must not be able to store a harsh count. Either evidence base
  -- admits one; neither admits none.
  CONSTRAINT fleet_vehicle_daily_stats_harsh_requires_coverage CHECK (
    coverage_gforce
    OR coverage_provider_events
    OR (harsh_brake_events = 0 AND harsh_accel_events = 0 AND harsh_corner_events = 0)
  ),

  -- A feed that does not assert ignition cannot claim ignition or idle time. distance_km and
  -- max_speed_kph stay allowed: those come from the odometer and the speed field, which snapshot
  -- feeds do supply.
  CONSTRAINT fleet_vehicle_daily_stats_ignition_requires_coverage CHECK (
    coverage_ignition OR (ignition_seconds = 0 AND idle_seconds = 0)
  ),

  -- A row that folded fixes must say which fix it folded last. Without this a stalled watermark
  -- and a genuinely empty day are the same row.
  CONSTRAINT fleet_vehicle_daily_stats_watermark_present CHECK (
    position_count = 0 OR source_watermark IS NOT NULL
  )
);

-- The fleet overview: every tracked vehicle for one day, newest day first. The per-vehicle series
-- is served by the primary key, which is already (vehicle_id, work_date).
CREATE INDEX IF NOT EXISTS ix_fleet_vehicle_daily_stats_work_date
  ON fleet_vehicle_daily_stats (work_date DESC);

COMMENT ON TABLE fleet_vehicle_daily_stats IS
  'Per-vehicle rollup of fleet_vehicle_positions over one SAST calendar day. Rebuilt in place; '
  'the coverage_* flags state what the day''s feed could actually observe.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.tracker_silence_seconds IS
  'LARGEST unobserved stretch in the day, not the sum. Includes the window''s head and tail -- the '
  'hours before the first fix and after the last -- not only the gaps between fixes.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.speeding_seconds IS
  'Shares the fold''s attribution ceiling with ignition time. 0 beside a non-zero speeding_events '
  'means the feed was too coarse to measure the duration, not that the event had none.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.coverage_gforce IS
  'A fix in THIS vehicle-day carried a non-zero linear_g or lateral_g. Never derived from the '
  'provider: six of seven cartrack/velocity vehicles report constant zero rather than null.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.coverage_provider_events IS
  'A fix in this vehicle-day carried provider_event_type. Cartrack firmware fires HARSH_BRAKING '
  'and HARSH_CORNERING on the family whose g columns are structurally zero.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.unattributed_seconds IS
  'Measured ignition time that could not be classified as moving or idling. A cartrack/velocity-'
  'only residual: a feed too coarse to measure ignition fails coverage_ignition and stores 0 here. '
  'GENERATED from ignition/moving/idle and therefore not assignable by a caller.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.first_ignition_at IS
  'An OBSERVATION -- a fix asserted ignition at this instant -- not a measurement, so it survives '
  'coverage_ignition = false. A two-hour feed can say when the vehicle first moved even though it '
  'cannot say for how long.';
COMMENT ON COLUMN fleet_vehicle_daily_stats.coverage_ignition IS
  'Ignition seconds are MEASURABLE on this vehicle-day: ignition asserted on >=90% of fixes AND '
  'the median inter-fix gap within the attribution ceiling. Not merely "the feed sends ignition".';

-- ---------------------------------------------------------------------------
-- Build watermarks
-- ---------------------------------------------------------------------------
-- Deliberately NOT shared with fleet_trip_build_watermarks. The two jobs have different backfill
-- ranges and different failure modes; one table would mean a stalled trip build silently stalls
-- the stats build, and a stats backfill silently rewinds the trip builder.
CREATE TABLE IF NOT EXISTS fleet_daily_stats_watermarks (
  vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  last_position_at TIMESTAMPTZ,
  last_built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  positions_processed BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fleet_daily_stats_watermarks_processed_nonnegative
    CHECK (positions_processed >= 0)
);

COMMENT ON TABLE fleet_daily_stats_watermarks IS
  'Per-vehicle high-water mark for the incremental vehicle-day stats build. Separate from '
  'fleet_trip_build_watermarks on purpose -- the two jobs fail and backfill independently.';

-- ---------------------------------------------------------------------------
-- Grants (mirrors 518 and 526)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_vehicle_daily_stats TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_daily_stats_watermarks TO fibreflow_user;
