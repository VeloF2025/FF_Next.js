-- Register five QFieldCloud civil-audit projects for Works QA and link them to their
-- existing FibreFlow projects. Companion: scripts/qfield_project_registry.py.
-- Verified live 2026-08-27. Idempotent (mirrors 468_qfield_namakgale_worksqa.sql).

BEGIN;

-- HT_Malmsbury -> Malmesbury
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = '1fb9b999-c668-4b94-8e6d-2c760049440b'::uuid) THEN
    RAISE EXCEPTION 'Malmesbury FibreFlow project is missing; refusing a dangling QField registration';
  END IF;
END $$;

INSERT INTO qfield_projects (qfield_project_id, name, description, is_active, is_default, sync_enabled)
VALUES ('d055742d-c5a0-439a-b270-70c63a9e0359', 'HT_Malmsbury', 'Malmesbury civil audit for Works QA', TRUE, FALSE, TRUE)
ON CONFLICT (qfield_project_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = TRUE, sync_enabled = TRUE, updated_at = NOW();

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, '1fb9b999-c668-4b94-8e6d-2c760049440b'::uuid FROM qfield_projects qp WHERE qp.qfield_project_id = 'd055742d-c5a0-439a-b270-70c63a9e0359'
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM qfield_project_links qpl JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
                 WHERE qp.qfield_project_id = 'd055742d-c5a0-439a-b270-70c63a9e0359' AND qpl.fibreflow_project_id = '1fb9b999-c668-4b94-8e6d-2c760049440b'::uuid) THEN
    RAISE EXCEPTION 'Malmesbury QField link was not created';
  END IF;
END $$;

-- FT_Mohadin_Phase_2 -> Mohadin Ph 2
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = '97426558-82d3-44f4-a071-d3b840bc90ed'::uuid) THEN
    RAISE EXCEPTION 'Mohadin Ph 2 FibreFlow project is missing; refusing a dangling QField registration';
  END IF;
END $$;

INSERT INTO qfield_projects (qfield_project_id, name, description, is_active, is_default, sync_enabled)
VALUES ('e867b23b-b44a-4655-a645-5040d3a0076c', 'FT_Mohadin_Phase_2', 'Mohadin Ph 2 civil audit for Works QA', TRUE, FALSE, TRUE)
ON CONFLICT (qfield_project_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = TRUE, sync_enabled = TRUE, updated_at = NOW();

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, '97426558-82d3-44f4-a071-d3b840bc90ed'::uuid FROM qfield_projects qp WHERE qp.qfield_project_id = 'e867b23b-b44a-4655-a645-5040d3a0076c'
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM qfield_project_links qpl JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
                 WHERE qp.qfield_project_id = 'e867b23b-b44a-4655-a645-5040d3a0076c' AND qpl.fibreflow_project_id = '97426558-82d3-44f4-a071-d3b840bc90ed'::uuid) THEN
    RAISE EXCEPTION 'Mohadin Ph 2 QField link was not created';
  END IF;
END $$;

-- FF_Chloorkop -> Chloorkop
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = '589dbd71-a12b-4cdf-ac87-507bee751703'::uuid) THEN
    RAISE EXCEPTION 'Chloorkop FibreFlow project is missing; refusing a dangling QField registration';
  END IF;
END $$;

INSERT INTO qfield_projects (qfield_project_id, name, description, is_active, is_default, sync_enabled)
VALUES ('3e0bf63f-b7c1-4f43-90b4-53d18dba3e6e', 'FF_Chloorkop', 'Chloorkop civil audit for Works QA', TRUE, FALSE, TRUE)
ON CONFLICT (qfield_project_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = TRUE, sync_enabled = TRUE, updated_at = NOW();

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, '589dbd71-a12b-4cdf-ac87-507bee751703'::uuid FROM qfield_projects qp WHERE qp.qfield_project_id = '3e0bf63f-b7c1-4f43-90b4-53d18dba3e6e'
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM qfield_project_links qpl JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
                 WHERE qp.qfield_project_id = '3e0bf63f-b7c1-4f43-90b4-53d18dba3e6e' AND qpl.fibreflow_project_id = '589dbd71-a12b-4cdf-ac87-507bee751703'::uuid) THEN
    RAISE EXCEPTION 'Chloorkop QField link was not created';
  END IF;
END $$;

-- FF_Protea_South -> Protea South
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = '89e59593-e6c2-46c4-8b8c-874e4cc72e92'::uuid) THEN
    RAISE EXCEPTION 'Protea South FibreFlow project is missing; refusing a dangling QField registration';
  END IF;
END $$;

INSERT INTO qfield_projects (qfield_project_id, name, description, is_active, is_default, sync_enabled)
VALUES ('f8f51027-4b29-4c76-b4d4-ba8765e930ad', 'FF_Protea_South', 'Protea South civil audit for Works QA', TRUE, FALSE, TRUE)
ON CONFLICT (qfield_project_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = TRUE, sync_enabled = TRUE, updated_at = NOW();

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, '89e59593-e6c2-46c4-8b8c-874e4cc72e92'::uuid FROM qfield_projects qp WHERE qp.qfield_project_id = 'f8f51027-4b29-4c76-b4d4-ba8765e930ad'
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM qfield_project_links qpl JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
                 WHERE qp.qfield_project_id = 'f8f51027-4b29-4c76-b4d4-ba8765e930ad' AND qpl.fibreflow_project_id = '89e59593-e6c2-46c4-8b8c-874e4cc72e92'::uuid) THEN
    RAISE EXCEPTION 'Protea South QField link was not created';
  END IF;
END $$;

-- FF_Kingsway -> Kingsway
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = '3981acb5-dbd3-4bca-9bed-a1edba1ff973'::uuid) THEN
    RAISE EXCEPTION 'Kingsway FibreFlow project is missing; refusing a dangling QField registration';
  END IF;
END $$;

INSERT INTO qfield_projects (qfield_project_id, name, description, is_active, is_default, sync_enabled)
VALUES ('f8e4e754-fbc0-4485-89ce-c72ea9614c98', 'FF_Kingsway', 'Kingsway civil audit for Works QA', TRUE, FALSE, TRUE)
ON CONFLICT (qfield_project_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  is_active = TRUE, sync_enabled = TRUE, updated_at = NOW();

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
SELECT qp.id, '3981acb5-dbd3-4bca-9bed-a1edba1ff973'::uuid FROM qfield_projects qp WHERE qp.qfield_project_id = 'f8e4e754-fbc0-4485-89ce-c72ea9614c98'
ON CONFLICT (qfield_project_id, fibreflow_project_id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM qfield_project_links qpl JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
                 WHERE qp.qfield_project_id = 'f8e4e754-fbc0-4485-89ce-c72ea9614c98' AND qpl.fibreflow_project_id = '3981acb5-dbd3-4bca-9bed-a1edba1ff973'::uuid) THEN
    RAISE EXCEPTION 'Kingsway QField link was not created';
  END IF;
END $$;

COMMIT;
