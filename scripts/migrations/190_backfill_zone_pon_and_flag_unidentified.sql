-- Migration 190: Backfill zone/PON from poles table + flag unidentified features
--
-- 1. Adds 'unidentified' to the workflow_status check constraint
-- 2. Updates zone_no and pon_no on construction_qa_reviews by joining to the poles table
-- 3. Flags reviews with non-standard feature_ids as workflow_status = 'unidentified'
--
-- Idempotent: safe to re-run.

BEGIN;

-- Step 0: Expand workflow_status check constraint to include 'unidentified'
ALTER TABLE construction_qa_reviews
  DROP CONSTRAINT IF EXISTS construction_qa_reviews_workflow_status_check;

ALTER TABLE construction_qa_reviews
  ADD CONSTRAINT construction_qa_reviews_workflow_status_check
  CHECK (workflow_status = ANY (ARRAY[
    'pending', 'in_review', 'approved', 'rejected',
    'rework_needed', 'escalated', 'unidentified'
  ]));

-- Step 1: Backfill zone_no and pon_no from poles table
-- Matches on (project_id, pole_number = feature_id)
UPDATE construction_qa_reviews cqr
SET zone_no = pl.zone_no,
    pon_no = pl.pon_no,
    updated_at = NOW()
FROM poles pl
WHERE cqr.feature_type = 'pole'
  AND pl.project_id = cqr.project_id
  AND pl.pole_number = cqr.feature_id
  AND (cqr.zone_no IS DISTINCT FROM pl.zone_no OR cqr.pon_no IS DISTINCT FROM pl.pon_no);

-- Step 2: Flag unidentified features
-- Real pole numbers match: LAW.P.xxx, MOA.P.xxx, ETW.P.xxx, MAM.P.xxx, TEM.P.xxx
-- Everything else is an unmatched filename/folder name from SharePoint
UPDATE construction_qa_reviews
SET workflow_status = 'unidentified',
    updated_at = NOW()
WHERE feature_type = 'pole'
  AND feature_id !~ '^[A-Z]{3}\.P\.'
  AND workflow_status != 'unidentified';

COMMIT;

-- Report results
SELECT 'Zone/PON backfilled' AS action,
       COUNT(*) AS count
FROM construction_qa_reviews
WHERE feature_type = 'pole' AND zone_no IS NOT NULL
UNION ALL
SELECT 'Still missing zone/PON (identified)',
       COUNT(*)
FROM construction_qa_reviews
WHERE feature_type = 'pole' AND zone_no IS NULL
  AND feature_id ~ '^[A-Z]{3}\.P\.'
UNION ALL
SELECT 'Flagged unidentified',
       COUNT(*)
FROM construction_qa_reviews
WHERE workflow_status = 'unidentified';
