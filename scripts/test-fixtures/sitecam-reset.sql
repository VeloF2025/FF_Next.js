-- SiteCam Test Fixtures — Reset Script
-- Run between test sessions to wipe submission state so you can retest from scratch.
-- Does NOT delete the drop/pole/session rows — only clears upload and appeal data.
--
-- Usage (on Velocity):
--   docker exec -i supabase-db psql -U postgres -d fibreflow < sitecam-reset.sql

\echo 'Clearing PWA submission state on test activation DRs...'

UPDATE dr_photo_unified_reviews
SET
  pwa_submission_at   = NULL,
  pwa_photo_count     = NULL,
  pwa_photo_urls      = NULL,
  pwa_tech_id         = NULL,
  pwa_completed_at    = NULL,
  updated_at          = NOW()
WHERE drop_number IN (
  'DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999'
);

\echo 'Clearing PWA submission state on test pole sessions...'

UPDATE pole_install_sessions
SET
  pwa_submission_at  = NULL,
  pwa_tech_id        = NULL,
  pwa_completed_at   = NULL
WHERE pole_number IN (
  'TEST-CIVIL-001','TEST-CIVIL-002','TEST-CIVIL-003','TEST-CIVIL-004','TEST-CIVIL-005'
);

\echo 'Deleting photo hashes for test site IDs...'

-- Activation site IDs use the DR prefix (e.g. DR9999990)
DELETE FROM pwa_photo_hashes
WHERE site_id IN (
  'DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999'
);

-- Civil site IDs use the pole number directly
DELETE FROM pwa_photo_hashes
WHERE site_id IN (
  'TEST-CIVIL-001','TEST-CIVIL-002','TEST-CIVIL-003','TEST-CIVIL-004','TEST-CIVIL-005'
);

\echo 'Deleting escalations (appeals) for test site IDs...'

DELETE FROM pwa_escalations
WHERE site_id IN (
  'DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999',
  'TEST-CIVIL-001','TEST-CIVIL-002','TEST-CIVIL-003','TEST-CIVIL-004','TEST-CIVIL-005'
);

\echo ''
\echo '=== Reset verification ==='
SELECT 'dr_submissions_cleared' AS check,
       COUNT(*) FILTER (WHERE pwa_submission_at IS NULL) AS cleared,
       COUNT(*) FILTER (WHERE pwa_submission_at IS NOT NULL) AS still_set
FROM dr_photo_unified_reviews
WHERE drop_number IN ('DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999')
UNION ALL
SELECT 'pole_submissions_cleared',
       COUNT(*) FILTER (WHERE pwa_submission_at IS NULL),
       COUNT(*) FILTER (WHERE pwa_submission_at IS NOT NULL)
FROM pole_install_sessions
WHERE pole_number LIKE 'TEST-CIVIL-%'
UNION ALL
SELECT 'photo_hashes_remaining',
       0,
       COUNT(*)
FROM pwa_photo_hashes
WHERE site_id IN (
  'DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999',
  'TEST-CIVIL-001','TEST-CIVIL-002','TEST-CIVIL-003','TEST-CIVIL-004','TEST-CIVIL-005'
)
UNION ALL
SELECT 'escalations_remaining',
       0,
       COUNT(*)
FROM pwa_escalations
WHERE site_id IN (
  'DR9999990','DR9999991','DR9999992','DR9999993','DR9999994','DR9999999',
  'TEST-CIVIL-001','TEST-CIVIL-002','TEST-CIVIL-003','TEST-CIVIL-004','TEST-CIVIL-005'
);

\echo 'Reset complete. All test IDs ready for a fresh run.'
