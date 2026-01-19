-- Migration 087: Assign project to OES-only imports based on team name
--
-- Problem: OES imports have team names but no project assignment.
-- When technicians don't submit via WhatsApp, the DR shows "Unknown" project.
--
-- Solution: Map OES team prefixes to projects:
--   law* -> Lawley
--   moa* / moh* -> Mohadin
--   mam* -> Mamelodi
--   etw* -> Etwatwa
--
-- Run: psql $DATABASE_URL -f scripts/migrations/087_oes_project_mapping.sql

-- Update project based on OES team mapping
UPDATE dr_photo_unified_reviews upr
SET project = CASE
  WHEN oes.team ILIKE 'law%' THEN 'Lawley'
  WHEN oes.team ILIKE 'mam%' THEN 'Mamelodi'
  WHEN oes.team ILIKE 'moa%' THEN 'Mohadin'
  WHEN oes.team ILIKE 'moh%' THEN 'Mohadin'
  WHEN oes.team ILIKE 'etw%' THEN 'Etwatwa'
  ELSE upr.project
END
FROM oes_activations oes
WHERE oes.drop_number = upr.drop_number
  AND upr.project IS NULL
  AND oes.team IS NOT NULL;

-- Report results
SELECT
  project,
  COUNT(*) as count
FROM dr_photo_unified_reviews
WHERE project IS NOT NULL
GROUP BY project
ORDER BY count DESC;
