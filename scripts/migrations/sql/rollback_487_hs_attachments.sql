-- Rollback 487: drop the H&S attachments table.
--
-- The indexes and constraints are owned by the table, so dropping it removes
-- them; they are not dropped separately.
--
-- NOTE: this drops the metadata rows, not the stored objects. Any files already
-- uploaded remain in VF Storage under hs-private/ and become unreferenced. They
-- are unreachable over HTTP (nginx 403s the prefix) but should be swept by hand
-- if this rollback is ever run against a database that holds real attachments:
--
--   SELECT file_path FROM hs_attachments;   -- capture BEFORE running this
--
-- Rerunnable.

BEGIN;

DROP TABLE IF EXISTS hs_attachments;

COMMIT;
