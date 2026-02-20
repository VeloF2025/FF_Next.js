-- Migration 191: Bulk ingest dome joints into Construction QA
-- Creates construction_qa_reviews stubs for all joints from the QField joints table.
-- Features-only ingestion (photo_count=0) — photos can be linked later via
-- SharePoint ingestion or QField photo validation.
--
-- Idempotent: safe to re-run (skips already-ingested joints).

BEGIN;

-- Insert one review per unique (project_id, joint_label) from the joints table
INSERT INTO construction_qa_reviews (
  project_id, discipline, feature_type, feature_id,
  zone_no, pon_no, photo_count,
  workflow_status, vlm_status, priority,
  extracted_joint_type, joint_cable_cap
)
SELECT
  j.project_id,
  'splicing',
  'joint',
  j.joint_label,
  j.zone_no,
  j.pon_no,
  0,
  'pending',
  'pending',
  'normal',
  j.joint_type,
  j.cable_capacity
FROM joints j
WHERE NOT EXISTS (
  SELECT 1 FROM construction_qa_reviews cqr
  WHERE cqr.project_id = j.project_id
    AND cqr.feature_type = 'joint'
    AND cqr.feature_id = j.joint_label
);

COMMIT;

-- Report results
SELECT p.project_name, COUNT(*) AS joint_reviews
FROM construction_qa_reviews r
JOIN projects p ON p.id = r.project_id
WHERE r.discipline = 'splicing'
  AND r.feature_type = 'joint'
GROUP BY p.project_name
ORDER BY p.project_name;

SELECT 'Total splicing reviews' AS label, COUNT(*) AS count
FROM construction_qa_reviews
WHERE discipline = 'splicing' AND feature_type = 'joint';
