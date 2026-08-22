// scripts/vlm-bench/harvest/civilSource.ts
import { selectRows } from './db';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

interface Row {
  photo_id: string;
  review_id: string;
  storage_key: string;
  filename: string | null;
  checklist_step: number | null;
  corrected_new_step: number | null;
  corrected_old_step: number | null;
}

/**
 * Ground truth is the PER-PHOTO human correction in vlm_corrections
 * (module='construction_qa', source_table='construction_qa_photos'):
 *   a correction row      → human moved the photo to newStep  (stratum vlm_wrong)
 *   no correction row, in
 *   a review a NAMED human
 *   decided on            → human left the VLM's step alone   (stratum vlm_right)
 *
 * The review-level civil_step_01..08 booleans are deliberately NOT used as
 * ground truth: vlmConstructionService recomputes them with
 * bool_or(checklist_step = N) from the VLM's OWN classifications, so scoring
 * against them would grade the model on its own output.
 *
 * construction_qa_photos.manual_reviewed_by is NULL for all 90,698 civil photos,
 * so there is no explicit per-photo approval to use for the vlm_right stratum —
 * the named-reviewer signal is the strongest available and is weaker evidence
 * than a correction. That asymmetry is recorded per case in `confirmation`.
 */
const SQL = `
WITH hr AS (
  SELECT DISTINCT review_id FROM construction_qa_activity
  WHERE event_type = 'decision_made'
    AND actor NOT IN ('current_user','system','vlm','batch-auto-approve','auto-approve')
)
SELECT p.id AS photo_id, p.review_id, p.storage_key, p.filename,
       p.checklist_step,
       (c.context_json->>'newStep')::int AS corrected_new_step,
       (c.context_json->>'oldStep')::int AS corrected_old_step
FROM construction_qa_photos p
JOIN construction_qa_reviews r
  ON r.id = p.review_id AND r.discipline = 'civil'
 AND r.vlm_status = 'completed' AND jsonb_array_length(r.photos_json) > 0
LEFT JOIN hr ON hr.review_id = p.review_id
LEFT JOIN LATERAL (
  SELECT id, context_json FROM vlm_corrections
  WHERE source_id = p.id AND module = 'construction_qa'
    AND context_json->>'newStep' IS NOT NULL
  ORDER BY created_at DESC LIMIT 1
) c ON true
WHERE p.source = 'local' AND p.upload_status = 'available'
  AND (c.id IS NOT NULL
       OR (hr.review_id IS NOT NULL AND p.checklist_step BETWEEN 0 AND 7))
`;

/** Civil photos live on velo's filesystem; the harvest runs there, so read them directly. */
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';

export async function civilCandidates(): Promise<Array<Candidate & HarvestItem>> {
  const rows = await selectRows<Row>(SQL);
  const items: Array<Candidate & HarvestItem> = [];
  for (const r of rows) {
    const corrected = r.corrected_new_step !== null;
    const step = corrected ? (r.corrected_new_step as number) : r.checklist_step;
    if (step === null || step < 0 || step > 7) continue;
    items.push({
      key: r.photo_id,
      stratum: corrected ? 'vlm_wrong' : 'vlm_right',
      fetchUrl: `file://${STORAGE_ROOT}/${r.storage_key}`,
      filename: r.filename ?? r.storage_key.split('/').pop() ?? r.photo_id,
      expected: {
        step,
        vlmStepAtReview: corrected ? r.corrected_old_step : r.checklist_step,
        stratum: corrected ? 'vlm_wrong' : 'vlm_right',
        reviewId: r.review_id,
        photoId: r.photo_id,
        storageKey: r.storage_key,
        confirmation: corrected ? 'human_correction' : 'named_reviewer_left_unchanged',
        provenance: { table: 'construction_qa_photos', rowId: r.photo_id },
      },
    });
  }
  return items;
}
