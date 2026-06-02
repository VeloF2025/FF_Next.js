-- Migration 400: SiteCam GPS-geofence capture
-- Purpose: record where the technician actually was relative to the planned
--          drop/pole location at capture time. Warn+allow+flag model — these
--          columns drive QA review, never block capture. All nullable; safe to re-run.
-- Applies to both submission tables (activations + civils).

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS geofence_status     TEXT,
  ADD COLUMN IF NOT EXISTS geofence_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lon          NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lat         NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lon         NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m      NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lon          NUMERIC;

ALTER TABLE pole_install_sessions
  ADD COLUMN IF NOT EXISTS geofence_status     TEXT,
  ADD COLUMN IF NOT EXISTS geofence_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lon          NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lat         NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lon         NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m      NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lon          NUMERIC;
