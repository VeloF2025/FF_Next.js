-- Add resolution_path column to maintenance_tickets
--
-- Drives the per-path verification step template, the Context Panel variant,
-- and the resolve-page flow. Set at ticket creation by the classifier
-- (src/modules/noc/services/resolutionPathClassifier.ts); 'triage_required'
-- means the link presents a single classification step to the technician.
--
-- Values:
--   install              — full new installation flow
--   maintenance          — fault repair on existing install
--   snag                 — civils/optical snag with before/after photos
--   investigate_data_gap — DR exists in one source, missing from another (no field work)
--   dispatch_signup      — no DR anywhere; visit address to obtain home sign-up
--   dispatch_install     — signup done, install pending
--   fix_serial           — ONT serial mismatch between OLT / 1Map / OES
--   fix_project_tag      — DR tagged to wrong project / region (data fix)
--   triage_required      — detector couldn't classify; technician picks on Step 1
--   not_applicable       — HSE / dev_ops / sales_lead tickets (this routing doesn't apply)

ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS resolution_path text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_tickets_resolution_path_check'
  ) THEN
    ALTER TABLE maintenance_tickets
      ADD CONSTRAINT maintenance_tickets_resolution_path_check CHECK (
        resolution_path IS NULL OR resolution_path IN (
          'install',
          'maintenance',
          'snag',
          'investigate_data_gap',
          'dispatch_signup',
          'dispatch_install',
          'fix_serial',
          'fix_project_tag',
          'triage_required',
          'not_applicable'
        )
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_resolution_path
  ON maintenance_tickets (resolution_path)
  WHERE resolution_path IS NOT NULL;

-- Backfill existing rows from (ticket_category, type, dr_number).
-- Best-effort mapping; anything ambiguous falls to 'triage_required' so the
-- technician (or an office user) classifies on next interaction.
--
-- Branch order matters: the 'not_applicable' WHEN must remain first so that
-- HSE / dev_ops / sales_lead tickets short-circuit before category-based
-- branches (e.g. a dev_ops ticket with ticket_category='pre_provision' must
-- land on 'not_applicable', not 'investigate_data_gap').
UPDATE maintenance_tickets
SET resolution_path = CASE
    WHEN ticket_category IN ('hse_incident', 'hse_near_miss', 'sales_lead', 'dev_ops')
         OR type = 'dev_ops'
      THEN 'not_applicable'
    WHEN ticket_category IN ('snag', 'internal_snag')
      THEN 'snag'
    WHEN ticket_category = 'home_signup_not_done'
      THEN 'dispatch_signup'
    WHEN ticket_category = 'ont_swap'
      THEN 'fix_serial'
    WHEN ticket_category = 'new_installation'
      THEN 'install'
    WHEN ticket_category IN ('fault_repair', 'modification', 'maintenance')
      THEN 'maintenance'
    WHEN ticket_category = 'pre_provision' AND dr_number IS NOT NULL
      THEN 'investigate_data_gap'
    WHEN ticket_category = 'pre_provision' AND dr_number IS NULL
      THEN 'triage_required'
    ELSE 'triage_required'
  END
WHERE resolution_path IS NULL;
