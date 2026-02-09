-- Migration 172: Update contractor onboarding stage required documents
-- Aligns onboarding workflow with actual documents being uploaded
--
-- Changes:
--   Stage 1 (Company Registration): Replace company_registration with directors_ids
--   Stage 4 (Insurance & Compliance): Add coid_registration
--   Stage 6 (Final Review): Add msa (Master Build Agreement)

-- Stage 1: Replace company_registration with directors_ids
-- Remove company_registration, add directors_ids
UPDATE contractor_onboarding_stages
SET required_documents = (
  SELECT jsonb_agg(elem)::text
  FROM (
    -- Keep existing docs except company_registration
    SELECT elem
    FROM jsonb_array_elements_text(required_documents::jsonb) AS elem
    WHERE elem != 'company_registration'
    UNION
    -- Add directors_ids if not already present
    SELECT 'directors_ids'
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(required_documents::jsonb) AS e WHERE e = 'directors_ids'
    )
  ) sub
)
WHERE stage_name = 'Company Registration'
  AND required_documents::jsonb ? 'company_registration';

-- Stage 4: Add coid_registration
UPDATE contractor_onboarding_stages
SET required_documents = (
  SELECT jsonb_agg(elem)::text
  FROM (
    SELECT elem FROM jsonb_array_elements_text(required_documents::jsonb) AS elem
    UNION
    SELECT 'coid_registration'
  ) sub
)
WHERE stage_name = 'Insurance & Compliance'
  AND NOT required_documents::jsonb ? 'coid_registration';

-- Stage 6: Add msa (Master Build Agreement)
UPDATE contractor_onboarding_stages
SET required_documents = '["msa"]'
WHERE stage_name = 'Final Review'
  AND (required_documents IS NULL OR required_documents = '[]' OR required_documents = '');
