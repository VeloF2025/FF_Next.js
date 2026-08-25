/**
 * Every statement `dailyStatsRepository` sends, as whole literals.
 *
 * Split out so each one can be read end to end, and so the file the R3 guard scans is small
 * enough that a stray conditional in it is obvious. Interpolated tagged-template conditionals are
 * broken in this repo and silently produce a malformed query, so an optional predicate is a whole
 * separate statement here rather than a fragment spliced into a shared one. Every statement opens
 * with a tag comment: it is what shows up in pg_stat_activity when a slow query needs a name.
 */

export const POSITIONS_ALL = `/* fleet-daily-stats:positions-all */
  SELECT id, recorded_at, provider_event_id, provider, account_ref, ignition, lat, lon,
         speed_kph, is_speeding, odometer_km, linear_g, lateral_g, provider_event_type
  FROM fleet_vehicle_positions
  WHERE vehicle_id = $1
  ORDER BY recorded_at, id
  LIMIT $2`;

export const POSITIONS_FROM_WINDOW = `/* fleet-daily-stats:positions-window */
  SELECT id, recorded_at, provider_event_id, provider, account_ref, ignition, lat, lon,
         speed_kph, is_speeding, odometer_km, linear_g, lateral_g, provider_event_type
  FROM fleet_vehicle_positions
  WHERE vehicle_id = $1
    AND recorded_at >= $2::timestamptz
  ORDER BY recorded_at, id
  LIMIT $3`;

export const POSITIONS_AFTER_CURSOR = `/* fleet-daily-stats:positions-after */
  SELECT id, recorded_at, provider_event_id, provider, account_ref, ignition, lat, lon,
         speed_kph, is_speeding, odometer_km, linear_g, lateral_g, provider_event_type
  FROM fleet_vehicle_positions
  WHERE vehicle_id = $1
    -- The PAIR, not recorded_at alone. Same-instant fixes are ordinary on this data, so a bare
    -- recorded_at cursor either drops the second twin (>) or re-feeds the first (>=).
    AND (recorded_at, id) > ($2::timestamptz, $3)
  ORDER BY recorded_at, id
  LIMIT $4`;

export const POSITION_BEFORE = `/* fleet-daily-stats:position-before */
  SELECT id, recorded_at, provider_event_id, provider, account_ref, ignition, lat, lon,
         speed_kph, is_speeding, odometer_km, linear_g, lateral_g, provider_event_type
  FROM fleet_vehicle_positions
  WHERE vehicle_id = $1
    -- Strictly before: the window's own first fix is read by the pager, not by this.
    AND recorded_at < $2::timestamptz
  ORDER BY recorded_at DESC, id DESC
  LIMIT 1`;

export const TRIPS_ALL = `/* fleet-daily-stats:trips-all */
  SELECT ignition_on_at, ignition_off_at
  FROM fleet_vehicle_trips
  WHERE vehicle_id = $1
    AND ignition_off_at IS NOT NULL
  ORDER BY ignition_on_at`;

export const TRIPS_FROM_WINDOW = `/* fleet-daily-stats:trips-window */
  SELECT ignition_on_at, ignition_off_at
  FROM fleet_vehicle_trips
  WHERE vehicle_id = $1
    AND ignition_off_at IS NOT NULL
    -- Filtered on the END, so a journey that began before the window but closed inside it still
    -- contributes the share of itself that fell in the window.
    AND ignition_off_at >= $2::timestamptz
  ORDER BY ignition_on_at`;

export const UPSERT_SQL = `/* fleet-daily-stats:upsert */
  INSERT INTO fleet_vehicle_daily_stats (
    vehicle_id, work_date, ignition_seconds, moving_seconds, idle_seconds, distance_km,
    max_speed_kph, speeding_events, speeding_seconds, harsh_brake_events, harsh_accel_events,
    harsh_corner_events, first_ignition_at, last_ignition_at, position_count,
    tracker_silence_seconds, provider, account_ref, coverage_granularity, coverage_ignition,
    coverage_gforce, coverage_provider_events, coverage_complete, source_watermark
  ) VALUES (
    $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
    $13::timestamptz, $14::timestamptz, $15, $16, $17, $18, $19, $20, $21, $22, $23,
    $24::timestamptz
  )
  -- DO UPDATE, never DO NOTHING: a vehicle-day is a function of its positions and re-folding it
  -- must replace it whole. DO NOTHING would freeze whichever partial fold inserted it first, and
  -- the first fold of TODAY is always partial.
  ON CONFLICT (vehicle_id, work_date) DO UPDATE SET
    ignition_seconds = EXCLUDED.ignition_seconds,
    moving_seconds = EXCLUDED.moving_seconds,
    idle_seconds = EXCLUDED.idle_seconds,
    distance_km = EXCLUDED.distance_km,
    max_speed_kph = EXCLUDED.max_speed_kph,
    speeding_events = EXCLUDED.speeding_events,
    speeding_seconds = EXCLUDED.speeding_seconds,
    harsh_brake_events = EXCLUDED.harsh_brake_events,
    harsh_accel_events = EXCLUDED.harsh_accel_events,
    harsh_corner_events = EXCLUDED.harsh_corner_events,
    first_ignition_at = EXCLUDED.first_ignition_at,
    last_ignition_at = EXCLUDED.last_ignition_at,
    position_count = EXCLUDED.position_count,
    tracker_silence_seconds = EXCLUDED.tracker_silence_seconds,
    provider = EXCLUDED.provider,
    account_ref = EXCLUDED.account_ref,
    coverage_granularity = EXCLUDED.coverage_granularity,
    coverage_ignition = EXCLUDED.coverage_ignition,
    coverage_gforce = EXCLUDED.coverage_gforce,
    coverage_provider_events = EXCLUDED.coverage_provider_events,
    coverage_complete = EXCLUDED.coverage_complete,
    source_watermark = EXCLUDED.source_watermark,
    computed_at = now()`;
