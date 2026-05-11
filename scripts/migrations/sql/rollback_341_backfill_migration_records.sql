-- Rollback 341: undo migration records backfill
--
-- WARNING: this only removes the bookkeeping entries — it does NOT
-- undo the schema changes those migrations actually applied to the DB.
-- Only use this rollback to clean up a bad 341 apply; never to attempt
-- un-applying 278-340 themselves.
--
-- After rollback, version 277 will be absent from the migrations table
-- (the runner will attempt to re-execute 277_*.sql on next run, which
-- will fail again unless the data issue is separately resolved).

BEGIN;

DELETE FROM migrations WHERE version IN (
  '278','279',
  '300','301','302','303','304','305','306','307','308','309',
  '311','312','313','314','315','316','317',
  '319',
  '321','322','323','324','325','326','327','328','329',
  '330','331','332','333','334',
  '336','337','339','340'
);

-- Restore 277 to its pre-341 failed state (success=false, error_message=NULL
-- since we can't reliably reproduce the exact original error string).
UPDATE migrations
SET    success       = false,
       error_message = NULL
WHERE  version = '277';

COMMIT;
