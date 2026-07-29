-- Register HT_Namakgale_P3_A1 and link it to the existing FibreFlow project.
--
-- Verified live 2026-07-29:
--   QFieldCloud: b32184d6-1776-4b89-8afd-2907dfca86d4 / HT_Namakgale_P3_A1
--   FibreFlow:   183fe626-7bf7-4793-bdb9-1a1dc2e21aa6 / Phalabrowa - Namakgale
--
-- Idempotent. The companion extractor config handles its distinct HT GPKG
-- schema (poles_phase_1 / NAME / PON / Phase).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM projects
    WHERE id = '183fe626-7bf7-4793-bdb9-1a1dc2e21aa6'::uuid
  ) THEN
    RAISE EXCEPTION 'Namakgale FibreFlow project is missing; refusing a dangling QField registration';
  END IF;
END $$;

INSERT INTO qfield_projects (
  qfield_project_id,
  name,
  description,
  is_active,
  is_default,
  sync_enabled
)
VALUES (
  'b32184d6-1776-4b89-8afd-2907dfca86d4',
  'HT_Namakgale_P3_A1',
  'HT Namakgale civil audit for Works QA',
  TRUE,
  FALSE,
  TRUE
)
ON CONFLICT (qfield_project_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = TRUE,
  sync_enabled = TRUE,
  updated_at = NOW();

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, '183fe626-7bf7-4793-bdb9-1a1dc2e21aa6'::uuid
FROM qfield_projects qp
WHERE qp.qfield_project_id = 'b32184d6-1776-4b89-8afd-2907dfca86d4'
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM qfield_project_links qpl
    JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
    WHERE qp.qfield_project_id = 'b32184d6-1776-4b89-8afd-2907dfca86d4'
      AND qpl.fibreflow_project_id = '183fe626-7bf7-4793-bdb9-1a1dc2e21aa6'::uuid
  ) THEN
    RAISE EXCEPTION 'Namakgale QField link was not created';
  END IF;
END $$;

COMMIT;
