-- Rollback 465: daily site H&S check-in
--
-- Drops the table and every check-in with it. Nothing else reads
-- hs_daily_checkins; the contractor gate degrades gracefully (a contractor
-- with no check-in rows is simply not blocked on check-ins, as before 465),
-- and hs_risk_register entries raised from hazards are left in place — they
-- are real findings that outlive the check-in that reported them.

BEGIN;

DROP TABLE IF EXISTS hs_daily_checkins;

DELETE FROM schema_migrations WHERE filename = '465_hs_daily_checkins.sql';

COMMIT;
