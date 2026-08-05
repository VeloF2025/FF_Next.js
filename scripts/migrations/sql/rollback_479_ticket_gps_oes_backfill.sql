-- Rollback 479: restore ticket GPS to the values held before the OES backfill.
--
-- Re-runnable: every statement is guarded, so a second run is a no-op rather
-- than an error. Restoring from the snapshot is exact — including rows whose
-- previous value was NULL, which is why `IS DISTINCT FROM` is used throughout
-- instead of `<>`.
--
-- Note the asymmetry: this restores the COLUMN, it does not restore the ranking.
-- The application code ranks the OES coordinate first at read time, so reverting
-- the data without reverting the deploy leaves new and edited tickets picking
-- OES again. Roll the code back too, or this only holds until the next write.

DO $$
BEGIN
  -- Unqualified on purpose: resolves through search_path, which lets the
  -- migration test run this file byte-identical inside a scratch schema.
  IF to_regclass('maintenance_tickets_gps_backup_479') IS NULL THEN
    RAISE NOTICE 'rollback 479: no snapshot table — migration 479 never ran here, nothing to undo';
    RETURN;
  END IF;

  UPDATE maintenance_tickets mt
     SET gps_coordinates = b.gps_coordinates,
         updated_at = NOW()
    FROM maintenance_tickets_gps_backup_479 b
   WHERE mt.id = b.ticket_id
     AND mt.gps_coordinates IS DISTINCT FROM b.gps_coordinates;

  RAISE NOTICE 'rollback 479: restored % ticket coordinates',
    (SELECT count(*) FROM maintenance_tickets_gps_backup_479);
END $$;

DROP TABLE IF EXISTS maintenance_tickets_gps_backup_479;

-- Clear this migration's own tracker row so the runner treats it as pending
-- again. Without this the forward file can never be re-applied.
DELETE FROM schema_migrations WHERE filename = '479_ticket_gps_oes_backfill.sql';
