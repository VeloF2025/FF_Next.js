-- rollback_525_fleet_vehicle_trips.sql
--
-- Drops only what 525 created. 525 is additive -- it ALTERs nothing existing -- so this rollback
-- cannot affect fleet_gps_trips, the investigation flow, or any other table.
--
-- Order: watermarks first, then trips. Neither references the other, so the order is for
-- readability rather than dependency, but keep it stable.
--
-- WARNING: this destroys the built trip history. The positions it was derived from remain in
-- fleet_vehicle_positions, so trips can be rebuilt by re-running the builder over the full range.

DROP TABLE IF EXISTS fleet_trip_build_watermarks;
DROP TABLE IF EXISTS fleet_vehicle_trips;
