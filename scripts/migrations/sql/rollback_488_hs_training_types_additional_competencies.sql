-- Rollback 488: remove the five competencies added by that migration.
--
-- Deletes only rows with no training records against them. hs_worker_training
-- references hs_training_types with ON DELETE RESTRICT, so a competency someone
-- has already been certified in would abort this whole script and take the
-- other four with it. Skipping those rows instead leaves the catalogue entry in
-- place — which is the correct outcome: the certificate that depends on it must
-- keep resolving to a real competency.
--
-- Rerunnable.

BEGIN;

DELETE FROM hs_training_types t
 WHERE t.code IN (
         'legal_liability',
         'incident_investigator',
         'she_supervisor',
         'ladder_inspector',
         'fall_protection_planner'
       )
   AND NOT EXISTS (
         SELECT 1 FROM hs_worker_training wt WHERE wt.training_type_id = t.id
       );

COMMIT;
