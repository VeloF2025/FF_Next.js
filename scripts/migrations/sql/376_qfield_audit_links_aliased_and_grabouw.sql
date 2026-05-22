-- Migration 376: link remaining audit QField projects (aliased rows + Grabouw)
--
-- Migration 372 linked the 4 audit projects whose qfield_projects.id == qfield_project_id.
-- It skipped 3 aliased projects (qfield_projects.id != qfield_project_id) because at
-- the time the sync code's JOIN compared `qfield_project_links.qfield_project_id =
-- qfield_photo_validations.project_id` directly — links pointing at aliased rows
-- would have been FK-valid but produced empty joins.
--
-- The same-PR code change (sync-qfield.ts + backfill-works-qa-from-qfield.js) now
-- joins through qfield_projects.qfield_project_id::text = qfield_photo_validations.project_id::text,
-- which correctly handles both shapes. With that in place these 5 links surface
-- previously-invisible photos to works-qa:
--
--   MAM Pole Audit (Offline) (4194a90c) → Mamelodi    276 rows
--   FT_Etwatwa_POP_2         (c7255076) → Etwatwa    4982 rows  (LARGEST)
--   VT_Tonga                 (ce3bf310) → Tonga      7681 rows  (LARGEST)
--   Grabouw QA               (b2cb67b1) → Grabouw     121 rows
--   Grabouw Drill Survey     (79db393c) → Grabouw       1 row
--
-- Estimated ~13,061 photo rows become reachable. NOT auto-imported — the next
-- run of backfill-works-qa-from-qfield.js (or the user clicking Sync QField in
-- the UI) will pull them.
--
-- Idempotent — qfield_project_links has UNIQUE(qfield_project_id, fibreflow_project_id).

BEGIN;

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, ff.id
FROM (VALUES
  ('MAM Pole Audit (Offline)', 'Mamelodi'),
  ('FT_Etwatwa_POP_2',         'Etwatwa'),
  ('VT_Tonga',                 'Tonga'),
  ('Grabouw QA',               'Grabouw'),
  ('Grabouw Drill Survey',     'Grabouw')
) AS m(qfield_name, ff_name)
JOIN qfield_projects qp ON qp.name = m.qfield_name
JOIN projects ff ON ff.project_name = m.ff_name
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$
DECLARE link_count INT;
BEGIN
  SELECT count(*) INTO link_count
  FROM qfield_project_links qpl
  JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
  WHERE qp.name IN (
    'MAM Pole Audit (Offline)', 'FT_Etwatwa_POP_2', 'VT_Tonga',
    'Grabouw QA', 'Grabouw Drill Survey'
  );
  IF link_count < 5 THEN
    RAISE EXCEPTION 'Expected 5 new audit links, found only % — aborting', link_count;
  END IF;
  RAISE NOTICE 'Aliased audit project links present: %', link_count;
END $$;

INSERT INTO migrations (version, name, executed_at)
VALUES ('376', 'qfield_audit_links_aliased_and_grabouw', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
