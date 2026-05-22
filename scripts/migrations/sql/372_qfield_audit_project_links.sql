-- Migration 372: link the "pole audit" qfield projects to their FibreFlow projects
--
-- Background:
-- Several QField projects collect QA photos for FibreFlow projects but were never
-- recorded in `qfield_project_links`. Their photos sit in qfield_photo_validations
-- with no path into works-qa. This is the root-cause counterpart of migration 370:
-- 370 rewrote broken paths inside pole_qa_photos.unassigned_photo_keys to point at
-- the resolvable equivalents already in qfield_photo_validations; 371 connects
-- the unlinked qfield projects so future syncs pick up their photos naturally.
--
-- Mapping verified by sampling feature_id patterns 2026-05-22:
--   MOA Pole Audit          → Mohadin   (493 of 692 rows have pole-label feature_ids)
--   ETW Pole Audit          → Etwatwa   (ETW.P.F* feature_ids)
--   LAW Pole Audit          → Lawley    (LAW.P.C* feature_ids)
--   MAM Pole Audit          → Mamelodi  (mostly filename feature_ids — some sync work needed)
--   MAM Pole Audit (Offline)→ Mamelodi  (same photos as MAM Pole Audit; treat as additional source)
--
-- Skipped here (link would be dead weight):
--   FT_Etwatwa_POP_2, VT_Tonga, MAM Pole Audit (Offline) have qfield_projects.id
--   ALIASED to a different UUID than qfield_projects.qfield_project_id.
--   The sync code joins
--     qfield_project_links.qfield_project_id = qfield_photo_validations.project_id
--   directly; that comparison only matches when qfield_projects.id equals
--   qfield_projects.qfield_project_id (because qfield_photo_validations.project_id
--   stores the EXTERNAL qfield project UUID). Linking aliased rows here would
--   leave the FK constraint satisfied but the join silently empty.
--   The aliasing fix is tracked as separate technical debt.
--
-- Skipped (no clear FF project):
--   Grabouw QA / Grabouw Drill Survey   (121 + 1 rows; needs FF project setup first)
--
-- Idempotent — qfield_project_links has a UNIQUE constraint on (qfield_project_id, fibreflow_project_id).

BEGIN;

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, ff.id
FROM (VALUES
  ('MOA Pole Audit',  'Mohadin'),
  ('ETW Pole Audit',  'Etwatwa'),
  ('LAW Pole Audit',  'Lawley'),
  ('MAM Pole Audit',  'Mamelodi')
) AS m(qfield_name, ff_name)
JOIN qfield_projects qp ON qp.name = m.qfield_name
JOIN projects ff ON ff.project_name = m.ff_name
WHERE qp.id::text = qp.qfield_project_id  -- skip aliased rows (see header comment)
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$
DECLARE link_count INT;
BEGIN
  SELECT count(*) INTO link_count
  FROM qfield_project_links qpl
  JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
  WHERE qp.name IN (
    'MOA Pole Audit', 'ETW Pole Audit', 'LAW Pole Audit', 'MAM Pole Audit'
  );
  IF link_count < 4 THEN
    RAISE EXCEPTION 'Expected 4 new audit links, found only % — aborting', link_count;
  END IF;
  RAISE NOTICE 'Audit project links present: %', link_count;
END $$;

INSERT INTO migrations (version, name, executed_at)
VALUES ('372', 'qfield_audit_project_links', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
