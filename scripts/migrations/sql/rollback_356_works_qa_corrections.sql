-- Rollback for migration 356_works_qa_corrections
--
-- Drops the works_qa_corrections table and its indexes. Data is lost.
-- Only run if works-qa VLM training feedback was rolled back as a feature.

DROP INDEX IF EXISTS idx_works_qa_corrections_slot;
DROP INDEX IF EXISTS idx_works_qa_corrections_photo;
DROP INDEX IF EXISTS idx_works_qa_corrections_snag;
DROP TABLE IF EXISTS works_qa_corrections;
