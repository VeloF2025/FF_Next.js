-- Rollback 502: restore the pre-cleanup staff.sa_id_number values from the
-- backup table written by the forward migration.
--
-- Pinned to rows that still hold the cleaned form (the last 13 characters of
-- the backed-up value), so a row corrected by hand since the migration is left
-- alone rather than silently reverted to a corrupt value.
--
-- Idempotent: a second run finds no backup table and does nothing.

DO $$
BEGIN
  IF to_regclass('public.staff_sa_id_prefix_backup_502') IS NULL THEN
    RAISE NOTICE 'rollback 502: no backup table, nothing to restore';
    RETURN;
  END IF;

  UPDATE staff s
     SET sa_id_number = b.sa_id_number,
         updated_at = NOW()
    FROM staff_sa_id_prefix_backup_502 b
   WHERE s.id = b.staff_id
     AND s.sa_id_number = right(b.sa_id_number, 13);

  DROP TABLE staff_sa_id_prefix_backup_502;
END $$;
