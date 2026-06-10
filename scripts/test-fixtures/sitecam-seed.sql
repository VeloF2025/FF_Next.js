-- SiteCam Test Fixtures — Seed Script
-- Run once to create test drops and poles for SiteCam PWA testing.
-- Re-running is safe (ON CONFLICT DO NOTHING on all inserts).
--
-- Usage (on Velocity):
--   docker exec -i supabase-db psql -U postgres -d fibreflow < sitecam-seed.sql
--
-- Activation DRs to enter in SiteCam PWA (bare numbers, no "DR" prefix):
--   9999990, 9999991, 9999992, 9999993, 9999994, 9999999 (pre-existing)
--
-- Civil pole IDs to enter in SiteCam PWA:
--   TEST-CIVIL-001, TEST-CIVIL-002, TEST-CIVIL-003, TEST-CIVIL-004, TEST-CIVIL-005

\echo 'Seeding SiteCam test drops...'

INSERT INTO drops (project_id, drop_number, address)
VALUES
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', '9999990', '10 Test Lane, Lawley'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', '9999991', '11 Test Lane, Lawley'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', '9999992', '12 Test Lane, Lawley'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', '9999993', '13 Test Lane, Lawley'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', '9999994', '14 Test Lane, Lawley')
ON CONFLICT (project_id, drop_number) DO NOTHING;

\echo 'Seeding dr_photo_unified_reviews for test DRs...'

INSERT INTO dr_photo_unified_reviews (drop_number, created_at, updated_at)
VALUES
  ('DR9999990', NOW(), NOW()),
  ('DR9999991', NOW(), NOW()),
  ('DR9999992', NOW(), NOW()),
  ('DR9999993', NOW(), NOW()),
  ('DR9999994', NOW(), NOW())
ON CONFLICT (drop_number) DO NOTHING;

\echo 'Seeding test civil poles...'

INSERT INTO poles (project_id, pole_number)
VALUES
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', 'TEST-CIVIL-002'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', 'TEST-CIVIL-003'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', 'TEST-CIVIL-004'),
  ('4eb13426-b2a1-472d-9b3c-277082ae9b55', 'TEST-CIVIL-005')
ON CONFLICT (project_id, pole_number) DO NOTHING;

\echo 'Seeding pole_install_sessions for test poles...'

-- TEST-CIVIL-001 may or may not already have a session — insert if missing
INSERT INTO pole_install_sessions (project_id, wa_group_jid, pole_number, sender_jid, sender_name, started_at, last_photo_at)
SELECT
  '4eb13426-b2a1-472d-9b3c-277082ae9b55',
  'test-sitecam-group@g.us',
  p.pole_number,
  'test-tech@s.whatsapp.net',
  'SiteCam Test Tech',
  NOW(),
  NOW()
FROM (VALUES
  ('TEST-CIVIL-001'),
  ('TEST-CIVIL-002'),
  ('TEST-CIVIL-003'),
  ('TEST-CIVIL-004'),
  ('TEST-CIVIL-005')
) AS p(pole_number)
WHERE NOT EXISTS (
  SELECT 1 FROM pole_install_sessions s
  WHERE s.pole_number = p.pole_number
  AND s.project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
);

\echo ''
\echo '=== Verification ==='
SELECT 'activation_drops' AS fixture, COUNT(*) AS count
  FROM drops
  WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
    AND drop_number IN ('9999990','9999991','9999992','9999993','9999994','9999999')
UNION ALL
SELECT 'dr_reviews', COUNT(*)
  FROM dr_photo_unified_reviews
  WHERE drop_number IN ('DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999')
UNION ALL
SELECT 'civil_poles', COUNT(*)
  FROM poles
  WHERE pole_number LIKE 'TEST-CIVIL-%'
UNION ALL
SELECT 'pole_sessions', COUNT(*)
  FROM pole_install_sessions
  WHERE pole_number LIKE 'TEST-CIVIL-%';

\echo 'Done. Run sitecam-reset.sql between test sessions.'
