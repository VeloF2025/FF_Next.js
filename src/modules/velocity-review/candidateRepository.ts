import { query } from '@/lib/db-pool';
import type { CandidateDbRow } from './types';

const CANDIDATE_QUERY = `
WITH params AS (SELECT $1::date AS target_date),
source_rows AS (
  SELECT UPPER(BTRIM(r.drop_number)) AS dr_number, 'dr_submitted'::text AS source
  FROM dr_photo_unified_reviews r, params p
  WHERE r.drop_number IS NOT NULL AND r.submitted_date = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(d.drop_number)), 'drops_installed'
  FROM drops d, params p
  WHERE d.drop_number IS NOT NULL
    AND COALESCE((d.installed_at AT TIME ZONE 'Africa/Johannesburg')::date,
                 d.installation_date) = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(s.installed_at_drop_number)), 'stock_installed'
  FROM stock_serials s, params p
  WHERE s.installed_at_drop_number IS NOT NULL
    AND (s.installed_date AT TIME ZONE 'Africa/Johannesburg')::date = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(o.drop_number)), 'oes_activated'
  FROM oes_activations o, params p
  WHERE o.drop_number IS NOT NULL
    AND COALESCE((o.activation_datetime AT TIME ZONE 'Africa/Johannesburg')::date,
                 o.activation_date) = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(pp.resolved_drop_number)), 'pp_activated'
  FROM oes_pp_data pp, params p
  WHERE pp.resolved_drop_number IS NOT NULL
    AND pp.resolution_status = 'activated'
    AND (COALESCE(pp.activated_at, pp.first_resolved_at, pp.resolved_at)
         AT TIME ZONE 'Africa/Johannesburg')::date = p.target_date
  UNION ALL
  SELECT UPPER(BTRIM(m.drop_number)), 'olt_mismatch_created'
  FROM olt_mismatch_records m, params p
  WHERE m.drop_number IS NOT NULL
    AND (m.created_at AT TIME ZONE 'Africa/Johannesburg')::date = p.target_date
),
candidates AS (
  SELECT dr_number, array_agg(DISTINCT source ORDER BY source) AS sources
  FROM source_rows WHERE dr_number <> '' GROUP BY dr_number
),
-- Per-column "newest non-null wins", NOT DISTINCT ON.
--
-- DISTINCT ON keeps one whole row and discards the rest, so when a drop has several
-- onemap rows -- 1.49 on average -- and the newest carries the phone while an older
-- one carries the name, the name is silently thrown away. That is exactly what
-- happened on 2026-08-04: all 262 exported contacts fell back to the 'there'
-- placeholder even though 27 had a real name on a sibling row.
-- See postgresql-gotchas SS53.
latest_onemap AS (
  SELECT
    UPPER(BTRIM(op.drop_number)) AS dr_number,
    (array_agg(NULLIF(BTRIM(op.contact_number), '') ORDER BY op.updated_at DESC NULLS LAST,
      op.import_id DESC NULLS LAST, op.id DESC)
      FILTER (WHERE NULLIF(BTRIM(op.contact_number), '') IS NOT NULL))[1] AS onemap_phone,
    (array_agg(NULLIF(BTRIM(op.contact_name), '') ORDER BY op.updated_at DESC NULLS LAST,
      op.import_id DESC NULLS LAST, op.id DESC)
      FILTER (WHERE NULLIF(BTRIM(op.contact_name), '') IS NOT NULL))[1] AS contact_name,
    (array_agg(NULLIF(BTRIM(op.contact_surname), '') ORDER BY op.updated_at DESC NULLS LAST,
      op.import_id DESC NULLS LAST, op.id DESC)
      FILTER (WHERE NULLIF(BTRIM(op.contact_surname), '') IS NOT NULL))[1] AS contact_surname,
    (array_agg(op.home_signup_date ORDER BY op.updated_at DESC NULLS LAST,
      op.import_id DESC NULLS LAST, op.id DESC)
      FILTER (WHERE op.home_signup_date IS NOT NULL))[1] AS home_signup_date
  FROM onemap_properties op
  JOIN candidates c ON c.dr_number = UPPER(BTRIM(op.drop_number))
  GROUP BY UPPER(BTRIM(op.drop_number))
),
reviews AS (
  SELECT UPPER(BTRIM(r.drop_number)) AS dr_number,
    (array_agg(NULLIF(BTRIM(r.subscriber_phone), '')
      ORDER BY r.submitted_date DESC NULLS LAST, r.updated_at DESC NULLS LAST)
      FILTER (WHERE NULLIF(BTRIM(r.subscriber_phone), '') IS NOT NULL))[1] AS subscriber_phone,
    (array_agg(NULLIF(BTRIM(r.qcontact_phone), '')
      ORDER BY r.submitted_date DESC NULLS LAST, r.updated_at DESC NULLS LAST)
      FILTER (WHERE NULLIF(BTRIM(r.qcontact_phone), '') IS NOT NULL))[1] AS qcontact_phone,
    -- Names live here too, and for far more drops than onemap carries them (207 vs 27
    -- across the 2026-08-01..03 window). Same newest-non-null pattern as the phones
    -- directly above. subscriber_name/qcontact_name are full names, so the split into
    -- given/family happens in candidateService.
    (array_agg(NULLIF(BTRIM(r.subscriber_name), '')
      ORDER BY r.submitted_date DESC NULLS LAST, r.updated_at DESC NULLS LAST)
      FILTER (WHERE NULLIF(BTRIM(r.subscriber_name), '') IS NOT NULL))[1] AS subscriber_name,
    (array_agg(NULLIF(BTRIM(r.qcontact_name), '')
      ORDER BY r.submitted_date DESC NULLS LAST, r.updated_at DESC NULLS LAST)
      FILTER (WHERE NULLIF(BTRIM(r.qcontact_name), '') IS NOT NULL))[1] AS qcontact_name,
    BOOL_OR(COALESCE(r.step_10_signature, FALSE)) AS signature_present,
    MAX(COALESCE(
      r.whatsapp_submitted_at,
      r.photos_fetched_at,
      r.created_at,
      r.submitted_date::timestamp AT TIME ZONE 'Africa/Johannesburg'
    )) FILTER (WHERE r.step_10_signature IS TRUE) AS signature_evidence_at
  FROM dr_photo_unified_reviews r
  JOIN candidates c ON c.dr_number = UPPER(BTRIM(r.drop_number))
  GROUP BY UPPER(BTRIM(r.drop_number))
)
SELECT c.dr_number, c.sources,
  o.onemap_phone, rv.subscriber_phone, rv.qcontact_phone,
  o.contact_name, o.contact_surname, o.home_signup_date,
  rv.subscriber_name, rv.qcontact_name,
  COALESCE(rv.signature_present, FALSE) AS signature_present,
  rv.signature_evidence_at
FROM candidates c
LEFT JOIN latest_onemap o USING (dr_number)
LEFT JOIN reviews rv USING (dr_number)
ORDER BY c.dr_number;
`;

export async function listCandidateRows(targetDate: string): Promise<CandidateDbRow[]> {
  return query<CandidateDbRow & Record<string, unknown>>(CANDIDATE_QUERY, [targetDate]);
}
