-- Migration 189: Bulk ingest QField photos into Construction QA
-- Moves pole_installation photos from qfield_photo_validations into
-- construction_qa_reviews + construction_qa_photos.
--
-- Idempotent: safe to re-run (skips already-ingested photos).

BEGIN;

-- Step 1: Create temporary project mapping
CREATE TEMP TABLE qf_project_map (
  qf_project_id UUID NOT NULL,
  ff_project_id UUID NOT NULL
);
INSERT INTO qf_project_map VALUES
  ('07b7109f-479b-4a7b-b33c-13e2af0c6bd3', '4eb13426-b2a1-472d-9b3c-277082ae9b55'), -- LAW Pole Audit → Lawley
  ('137eb5ec-4c0b-4eab-8a5c-de046eb06349', 'bf9a90db-e758-4c05-b999-694cd63c451f'), -- MOA Pole Audit → Mohadin
  ('04900ce2-1f2e-45bf-b3c8-8c78bc6540db', 'c7255076-1d2f-41ce-97bb-858b8c87ee27'), -- ETW Pole Audit → Etwatwa
  ('c1e14ea2-489c-4376-a59a-1253df404dde', '7003dc06-9af7-4a7c-bc6c-a177d77784f2'); -- MAM Pole Audit → Mamelodi

-- Step 2: Insert missing reviews (one per unique feature_id per project)
-- Only for pole_installation work_type, features not yet in construction_qa_reviews
INSERT INTO construction_qa_reviews (
  project_id, discipline, feature_type, feature_id,
  zone_no, pon_no, photo_count, last_photo_at,
  workflow_status, vlm_status, priority
)
SELECT
  m.ff_project_id,
  'civil',
  'pole',
  qpv.feature_id,
  pl.zone_no,
  pl.pon_no,
  0, -- will be updated in step 4
  MAX(qpv.created_at),
  'pending',
  'pending',
  'normal'
FROM qfield_photo_validations qpv
JOIN qf_project_map m ON m.qf_project_id = qpv.project_id
LEFT JOIN poles pl ON pl.project_id = m.ff_project_id AND pl.pole_number = qpv.feature_id
WHERE qpv.feature_id IS NOT NULL
  AND qpv.work_type = 'pole_installation'
  AND NOT EXISTS (
    SELECT 1 FROM construction_qa_reviews cqr
    WHERE cqr.project_id = m.ff_project_id
      AND cqr.feature_type = 'pole'
      AND cqr.feature_id = qpv.feature_id
  )
GROUP BY m.ff_project_id, qpv.feature_id, pl.zone_no, pl.pon_no;

-- Step 3: Insert missing photos
-- Link each QField photo to its construction_qa_review
INSERT INTO construction_qa_photos (
  review_id, project_id, source, storage_key, filename, mime_type,
  vlm_valid, vlm_confidence, vlm_feedback, needs_retake
)
SELECT
  cqr.id,
  m.ff_project_id,
  'qfield',
  qpv.photo_key,
  COALESCE(
    NULLIF(SUBSTRING(qpv.photo_key FROM '[^/]+$'), ''),
    qpv.photo_key
  ),
  'image/jpeg',
  CASE WHEN qpv.vlm_confidence IS NOT NULL THEN qpv.vlm_confidence >= 0.6 ELSE NULL END,
  qpv.vlm_confidence,
  qpv.vlm_feedback,
  COALESCE(qpv.needs_retake, false)
FROM qfield_photo_validations qpv
JOIN qf_project_map m ON m.qf_project_id = qpv.project_id
JOIN construction_qa_reviews cqr
  ON cqr.project_id = m.ff_project_id
  AND cqr.feature_type = 'pole'
  AND cqr.feature_id = qpv.feature_id
WHERE qpv.feature_id IS NOT NULL
  AND qpv.work_type = 'pole_installation'
  AND NOT EXISTS (
    SELECT 1 FROM construction_qa_photos cqp
    WHERE cqp.storage_key = qpv.photo_key
      AND cqp.source = 'qfield'
  );

-- Step 4: Recalculate photo_count for all affected reviews
UPDATE construction_qa_reviews cqr
SET photo_count = sub.cnt,
    last_photo_at = sub.max_created,
    updated_at = NOW()
FROM (
  SELECT cqp.review_id,
         COUNT(*) AS cnt,
         MAX(cqp.created_at) AS max_created
  FROM construction_qa_photos cqp
  WHERE cqp.source = 'qfield'
  GROUP BY cqp.review_id
) sub
WHERE cqr.id = sub.review_id
  AND cqr.photo_count != sub.cnt;

-- But reviews may also have SharePoint photos — recalculate from ALL sources
UPDATE construction_qa_reviews cqr
SET photo_count = sub.total_cnt,
    updated_at = NOW()
FROM (
  SELECT cqp.review_id, COUNT(*) AS total_cnt
  FROM construction_qa_photos cqp
  GROUP BY cqp.review_id
) sub
WHERE cqr.id = sub.review_id
  AND cqr.photo_count != sub.total_cnt;

COMMIT;

-- Report results
SELECT 'Reviews' AS entity,
       COUNT(*) AS total
FROM construction_qa_reviews cqr
JOIN (SELECT DISTINCT ff_project_id FROM qf_project_map) m ON m.ff_project_id = cqr.project_id
WHERE cqr.feature_type = 'pole'
UNION ALL
SELECT 'QField Photos',
       COUNT(*)
FROM construction_qa_photos
WHERE source = 'qfield'
UNION ALL
SELECT 'SharePoint Photos',
       COUNT(*)
FROM construction_qa_photos
WHERE source = 'sharepoint';
