-- Read-only readiness report for Velocity review export migration 472.

SELECT EXISTS (
  SELECT 1 FROM schema_migrations
  WHERE filename = '469_wa_subscriber_consent.sql'
) AS migration_469_exists;

SELECT to_regclass('wa_subscriber_consent') IS NOT NULL AS consent_table_exists \gset
\if :consent_table_exists
  SELECT source, COUNT(*) AS row_count
  FROM wa_subscriber_consent
  GROUP BY source
  ORDER BY source;
\else
  SELECT 'wa_subscriber_consent absent' AS consent_source_status;
\endif

SELECT to_regclass('velocity_review_candidates') IS NOT NULL AS candidates_table_exists \gset
\if :candidates_table_exists
  SELECT target_date, dr_number, COUNT(*) AS duplicate_count
  FROM velocity_review_candidates
  GROUP BY target_date, dr_number
  HAVING COUNT(*) > 1
  ORDER BY target_date, dr_number;
\else
  SELECT 'velocity_review_candidates absent' AS candidate_duplicate_status;
\endif

SELECT to_regclass('velocity_review_exports') IS NOT NULL AS exports_table_exists \gset
\if :exports_table_exists
  SELECT dr_number, phone_fingerprint, COUNT(*) AS duplicate_count
  FROM velocity_review_exports
  GROUP BY dr_number, phone_fingerprint
  HAVING COUNT(*) > 1
  ORDER BY dr_number, phone_fingerprint;
\else
  SELECT 'velocity_review_exports absent' AS export_duplicate_status;
\endif
