-- 441: Fleet live tracking — provider-blind position store.
-- Design: docs/superpowers/specs/2026-07-15-fleet-live-tracking-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS fleet_vehicle_trackers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  provider    VARCHAR(20) NOT NULL CHECK (provider IN ('cartrack','netstar','ituran')),
  account_ref VARCHAR(50) NOT NULL,
  external_id VARCHAR(64) NOT NULL CHECK (btrim(external_id) <> ''),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE fleet_vehicle_trackers IS
  'Single source of truth for which tracker reports for which vehicle. Replaces fleet_vehicles.cartrack_vehicle_id.';
COMMENT ON COLUMN fleet_vehicle_trackers.account_ref IS
  'Which tenant/account on the provider. Credentials live in .claude/credentials.local.md, never here.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_trackers_identity
  ON fleet_vehicle_trackers (provider, account_ref, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_trackers_one_active_per_vehicle
  ON fleet_vehicle_trackers (vehicle_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS fleet_vehicle_positions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  tracker_id        UUID REFERENCES fleet_vehicle_trackers(id) ON DELETE SET NULL,
  provider          VARCHAR(20) NOT NULL CHECK (provider IN ('cartrack','netstar','ituran')),
  provider_event_id VARCHAR(64),
  recorded_at       TIMESTAMPTZ NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat               NUMERIC(10,7) NOT NULL,
  lon               NUMERIC(10,7) NOT NULL,
  speed_kph         NUMERIC(6,2),
  road_speed_kph    NUMERIC(6,2),
  is_speeding       BOOLEAN,
  ignition          BOOLEAN,
  odometer_km       NUMERIC(12,2),
  linear_g          NUMERIC(5,3),
  lateral_g         NUMERIC(5,3),
  bearing           NUMERIC(5,2),
  altitude_m        NUMERIC(7,2),
  gps_fix_type      SMALLINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN fleet_vehicle_positions.road_speed_kph IS 'Legal limit of the road, as reported by the provider.';
COMMENT ON COLUMN fleet_vehicle_positions.odometer_km IS 'Cartrack reports metres; divided by 1000 at ingest.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_positions_provider_event
  ON fleet_vehicle_positions (provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_positions_vehicle_time
  ON fleet_vehicle_positions (vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_positions_time
  ON fleet_vehicle_positions (recorded_at);
CREATE INDEX IF NOT EXISTS idx_fleet_positions_speeding
  ON fleet_vehicle_positions (vehicle_id, recorded_at DESC) WHERE is_speeding;

CREATE TABLE IF NOT EXISTS fleet_tracking_watermarks (
  provider             VARCHAR(20) NOT NULL,
  account_ref          VARCHAR(50) NOT NULL,
  last_event_ts        TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, account_ref)
);

-- fleet_gps_trips.vehicle_id: live trips have no upload job, AND
-- driverScoreService.calculateAuthorizationScore already queries this
-- column, which never existed — the query throws and is swallowed.
ALTER TABLE fleet_gps_trips ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES fleet_vehicles(id);
ALTER TABLE fleet_gps_trips ALTER COLUMN job_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_gps_trips_vehicle ON fleet_gps_trips (vehicle_id);

-- Superseded by fleet_vehicle_trackers. 0 rows — nothing to migrate.
ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS cartrack_vehicle_id;

COMMIT;
