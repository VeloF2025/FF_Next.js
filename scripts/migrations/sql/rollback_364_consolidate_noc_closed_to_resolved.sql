-- Rollback for migration 364.
--
-- WARNING: This is best-effort. The forward migration loses the distinction
-- between tickets that were originally 'resolved' and tickets that were
-- 'closed', so a literal rollback is impossible without external evidence.
--
-- This rollback is intentionally a no-op so an accidental `migrate down`
-- does not corrupt the resolved bucket by flipping legitimate resolved
-- tickets back to closed. If you genuinely need to restore the split,
-- recover the prior state from a pre-364 database backup.

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'Rollback 364: no-op — see file header for why';
END $$;

COMMIT;
