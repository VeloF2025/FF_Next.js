// scripts/vlm-bench/harvest/serialsSource.ts
import { resolveImageUrl } from '@/modules/activate/services/categorizationImageFetcher';
import { selectRows } from './db';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

interface Row {
  review_id: string;
  drop_number: string;
  variant: 'back' | 'front';
  serial: string;
  vlm_value: string | null;
  filename: string;
  url: string;
  corrected: boolean;
}

/**
 * Serial ground truth, per photo.
 *
 *   vlm_wrong — a vlm_corrections row: a human typed the right serial after
 *               seeing the VLM's wrong one. corrected_value is the label.
 *   vlm_right — the review's independently barcode-scanned ont_serial_scanned,
 *               on a review with NO activate correction at all.
 *
 * vlm_corrections holds ONLY corrections — every one of the 10,964 activate
 * serial rows has vlm_extracted_value <> corrected_value — so it cannot supply
 * a confirmed stratum on its own. ont_serial_scanned is the independent source.
 *
 * Both strata are restricted to reviews with EXACTLY ONE photo at the target
 * step (6 = ONT back, 9 = front panel) whose step a human confirmed in
 * vlm_categorization_results. Without that, "the step-6 photo" is a guess: the
 * step in photos_metadata is derived from OneMap's original_type, which is
 * routinely wrong — that inaccuracy is the entire reason the categorization
 * pack exists. Labelling a photo that does not show the serial would fabricate
 * ground truth rather than measure it.
 */
const SQL = `
WITH steps AS (SELECT * FROM (VALUES (6,'back'),(9,'front')) AS t(want_step, variant)),
base AS (
  SELECT v.id AS review_id, v.drop_number, v.photos_metadata, v.vlm_categorization_results,
         v.ont_serial_scanned, s.want_step, s.variant,
         (SELECT jsonb_agg(pm) FROM jsonb_array_elements(v.photos_metadata) pm
           WHERE (pm->>'step')::int = s.want_step) AS m
  FROM dr_photo_unified_reviews v CROSS JOIN steps s
  WHERE jsonb_array_length(v.photos_metadata) > 0
    AND jsonb_typeof(v.vlm_categorization_results) = 'array'
),
one_photo AS (
  SELECT b.*, b.m->0->>'filename' AS filename, b.m->0->>'url' AS url
  FROM base b
  WHERE jsonb_array_length(b.m) = 1
    AND b.m->0->>'url' IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(b.vlm_categorization_results) r
      WHERE r->>'photo_filename' = b.m->0->>'filename'
        AND r->>'human_approved' = 'true'
        AND (r->>'vlm_predicted_step')::int = b.want_step
    )
)
SELECT review_id, drop_number, variant, filename, url,
       upper(c.corrected_value) AS serial, c.vlm_extracted_value AS vlm_value, true AS corrected
FROM one_photo o
JOIN LATERAL (
  SELECT corrected_value, vlm_extracted_value FROM vlm_corrections
  WHERE source_id = o.review_id AND module = 'activate'
    AND analysis_type = CASE WHEN o.variant = 'back' THEN 'ont_serial_back' ELSE 'ont_serial_front' END
    AND corrected_value ~* '^ALCLB4[0-9A-F]{6}$'
  ORDER BY created_at DESC LIMIT 1
) c ON true

UNION ALL

SELECT review_id, drop_number, variant, filename, url,
       upper(o.ont_serial_scanned) AS serial, NULL AS vlm_value, false AS corrected
FROM one_photo o
WHERE o.ont_serial_scanned ~* '^ALCLB4[0-9A-F]{6}$'
  AND NOT EXISTS (SELECT 1 FROM vlm_corrections c2 WHERE c2.source_id = o.review_id AND c2.module = 'activate')
`;

/** Which failure the human was correcting — reported so strata can be audited. */
function errorPattern(vlmValue: string | null): string | null {
  if (!vlmValue) return null;
  if (/^ALCLB4[0-9A-F]{6}$/i.test(vlmValue)) return 'wrong_serial_on_label';
  if (/^ALCL/i.test(vlmValue)) return 'malformed_alcl';
  if (/^ALHN/i.test(vlmValue)) return 'ssid_instead_of_serial';
  if (/^STN/i.test(vlmValue)) return 'part_number_instead_of_serial';
  return 'other';
}

export async function serialsCandidates(): Promise<Array<Candidate & HarvestItem>> {
  const rows = await selectRows<Row>(SQL);
  return rows.map((r) => ({
    key: `${r.review_id}:${r.variant}:${r.filename}`,
    stratum: r.corrected ? ('vlm_wrong' as const) : ('vlm_right' as const),
    // Balance back/front within each stratum: front outnumbers back ~2:1 in the
    // correction pool, so an unbalanced draw would under-test the back label,
    // which is where the two-serial (S/N vs S/N II) failure lives.
    subgroup: r.variant,
    fetchUrl: resolveImageUrl(r.url),
    filename: r.filename,
    expected: {
      serial: r.serial,
      variant: r.variant,
      stratum: r.corrected ? 'vlm_wrong' : 'vlm_right',
      vlmValueAtReview: r.vlm_value,
      errorPattern: errorPattern(r.vlm_value),
      // Confirmed cases rest on a barcode scan for the DR, not on a human
      // reading THIS photo. Measured against the 10,881 correction rows that
      // also carry a scan, that label disagrees with the photo ~1% of the time.
      confirmation: r.corrected ? 'human_correction' : 'barcode_scan_undisputed',
      drNumber: r.drop_number,
      provenance: { table: 'dr_photo_unified_reviews', rowId: r.review_id, photoFilename: r.filename },
    },
  }));
}
