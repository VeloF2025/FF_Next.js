-- Rollback for migration 371: remove the audit project links

BEGIN;

DELETE FROM qfield_project_links
WHERE (qfield_project_id, fibreflow_project_id) IN (
  SELECT qp.id, ff.id
  FROM (VALUES
    ('MOA Pole Audit',  'Mohadin'),
    ('ETW Pole Audit',  'Etwatwa'),
    ('LAW Pole Audit',  'Lawley'),
    ('MAM Pole Audit',  'Mamelodi')
  ) AS m(qfield_name, ff_name)
  JOIN qfield_projects qp ON qp.name = m.qfield_name
  JOIN projects ff ON ff.project_name = m.ff_name
);

DELETE FROM migrations WHERE version = '372';

COMMIT;
