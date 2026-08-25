-- rollback_528_fleet_vehicle_daily_stats.sql
--
-- Drops exactly what 528 created: the two new tables and the one new column.
--
-- WARNING, and it is the whole reason this file names the column explicitly: dropping
-- fleet_vehicle_positions.provider_event_type DESTROYS captured provider event history. The
-- positions themselves survive, but Cartrack's event_description is only available from the live
-- API for a limited window, so anything already ingested and then dropped cannot be recovered by
-- re-running the poller over the same range. Rolling forward again gives an all-NULL column for
-- every fix that was ingested in between.
--
-- The two tables are pure derived state and can be rebuilt from fleet_vehicle_positions by
-- re-running the fold over the full range.
--
-- Order: watermarks first, then stats. Neither references the other, so this is for readability.

DROP TABLE IF EXISTS fleet_daily_stats_watermarks;
DROP TABLE IF EXISTS fleet_vehicle_daily_stats;

ALTER TABLE fleet_vehicle_positions DROP COLUMN IF EXISTS provider_event_type;
