-- Rollback 451: H&S training matrix & competency
--
-- Drops the two tables added by 451. The training catalogue and every worker
-- training record go with them — there is no other consumer, and the contractor
-- gate degrades gracefully (training_score returns to NULL = does not block).

BEGIN;

DROP TABLE IF EXISTS hs_worker_training;
DROP TABLE IF EXISTS hs_training_types;

DELETE FROM schema_migrations WHERE filename = '451_hs_training_matrix.sql';

COMMIT;
