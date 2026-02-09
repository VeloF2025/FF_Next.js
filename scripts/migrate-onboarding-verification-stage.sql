-- Migration: Add "Company Verification" as stage 2 for existing contractors
-- Shifts existing stages 2-5 to 3-6, inserts new verification stage
-- Safe to run multiple times (ON CONFLICT DO NOTHING)

-- Step 1: Shift existing stage_order >= 2 by +1
UPDATE contractor_onboarding_stages
SET stage_order = stage_order + 1, updated_at = NOW()
WHERE stage_order >= 2
  AND stage_name != 'Company Verification';

-- Step 2: Insert "Company Verification" stage for all existing contractors
INSERT INTO contractor_onboarding_stages (
  contractor_id, stage_name, stage_order, status,
  completion_percentage, required_documents, completed_documents
)
SELECT DISTINCT
  contractor_id,
  'Company Verification',
  2,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM contractor_onboarding_stages s2
      WHERE s2.contractor_id = contractor_onboarding_stages.contractor_id
        AND s2.stage_name = 'Final Review'
        AND s2.status = 'completed'
    ) THEN 'skipped'
    ELSE 'pending'
  END,
  0,
  '[]',
  '[]'
FROM contractor_onboarding_stages
ON CONFLICT (contractor_id, stage_name) DO NOTHING;

-- Step 3: Fix stage names that may have shifted
UPDATE contractor_onboarding_stages SET stage_order = 1 WHERE stage_name = 'Company Registration';
UPDATE contractor_onboarding_stages SET stage_order = 2 WHERE stage_name = 'Company Verification';
UPDATE contractor_onboarding_stages SET stage_order = 3 WHERE stage_name = 'Financial Documentation';
UPDATE contractor_onboarding_stages SET stage_order = 4 WHERE stage_name = 'Insurance & Compliance';
UPDATE contractor_onboarding_stages SET stage_order = 5 WHERE stage_name = 'Technical Qualifications';
UPDATE contractor_onboarding_stages SET stage_order = 6 WHERE stage_name = 'Final Review';
