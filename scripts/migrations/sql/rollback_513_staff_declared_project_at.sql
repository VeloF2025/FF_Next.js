-- Rollback 513. Loses the freshness of every project declaration; the column
-- reverts to an undated value that cannot answer "did they tell us today".
ALTER TABLE staff DROP COLUMN IF EXISTS declared_project_at;
