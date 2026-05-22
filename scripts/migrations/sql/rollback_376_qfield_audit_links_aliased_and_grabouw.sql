-- Rollback for migration 376: remove the aliased + Grabouw audit project links

BEGIN;

DELETE FROM qfield_project_links
WHERE (qfield_project_id, fibreflow_project_id) IN (
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
);

DELETE FROM migrations WHERE version = '376';

COMMIT;
