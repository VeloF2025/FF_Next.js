// scripts/vlm-bench/harvest/categorizationSource.ts
import { resolveImageUrl } from '@/modules/activate/services/categorizationImageFetcher';
import { selectRows } from './db';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

interface Row {
  review_id: string;
  drop_number: string;
  filename: string;
  vlm_step: number | null;
  override_step: number | null;
  approved: string | null;
  url: string;
}

/**
 * Ground truth is the PER-PHOTO human verdict in vlm_categorization_results:
 *   human_override_step IS NOT NULL  → human corrected the VLM  (stratum vlm_wrong)
 *   human_approved = 'true'          → human confirmed the VLM  (stratum vlm_right)
 *
 * The review-level step_01..step_10 booleans are deliberately NOT used: they are
 * DR-level coverage flags, not per-photo labels, so they cannot say which photo
 * a human judged to be which step.
 */
const SQL = `
WITH r AS (
  SELECT v.id AS review_id, v.drop_number, v.photos_metadata,
         jsonb_array_elements(v.vlm_categorization_results) AS c
  FROM dr_photo_unified_reviews v
  WHERE jsonb_typeof(v.vlm_categorization_results) = 'array'
    AND v.reviewed_by IS NOT NULL
    AND jsonb_array_length(v.photos_metadata) > 0
)
SELECT review_id, drop_number,
       c->>'photo_filename' AS filename,
       NULLIF(c->>'vlm_predicted_step','')::int AS vlm_step,
       NULLIF(c->>'human_override_step','')::int AS override_step,
       c->>'human_approved' AS approved,
       (SELECT p->>'url' FROM jsonb_array_elements(photos_metadata) p
         WHERE p->>'filename' = c->>'photo_filename' LIMIT 1) AS url
FROM r
WHERE (SELECT p->>'url' FROM jsonb_array_elements(photos_metadata) p
        WHERE p->>'filename' = c->>'photo_filename' LIMIT 1) IS NOT NULL
  AND (NULLIF(c->>'human_override_step','') IS NOT NULL OR c->>'human_approved' = 'true')
`;

export async function categorizationCandidates(): Promise<Array<Candidate & HarvestItem>> {
  const rows = await selectRows<Row>(SQL);
  const items: Array<Candidate & HarvestItem> = [];
  for (const r of rows) {
    const corrected = r.override_step !== null;
    // A confirmation is only usable when we know WHAT was confirmed.
    if (!corrected && r.vlm_step === null) continue;
    const step = corrected ? (r.override_step as number) : (r.vlm_step as number);
    // Step -1 ("Duplicate Photo") is excluded even though it is the single most
    // common human override. buildCategorizationPrompt only ever offers 0-12, so
    // the model CANNOT answer -1: duplicates are caught by a separate detector,
    // not by this prompt. Keeping those cases would add ~34% guaranteed-zero
    // scores that say nothing about the prompt under test.
    if (step < 0 || step > 12) continue;
    const key = `${r.review_id}:${r.filename}`;
    items.push({
      key,
      stratum: corrected ? 'vlm_wrong' : 'vlm_right',
      fetchUrl: resolveImageUrl(r.url),
      filename: r.filename,
      expected: {
        step,
        vlmStepAtReview: r.vlm_step,
        stratum: corrected ? 'vlm_wrong' : 'vlm_right',
        drNumber: r.drop_number,
        photoFilename: r.filename,
        provenance: { table: 'dr_photo_unified_reviews', rowId: r.review_id, photoFilename: r.filename },
      },
    });
  }
  return items;
}
