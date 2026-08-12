/**
 * The works-QA photo corpus — the third store, and the only one that carries
 * acceptance-grade classification.
 *
 * `pole_qa_photos` holds ONE ROW PER POLE with up to 22 photo keys spread across named
 * slot columns, plus a per-slot VLM verdict in `vlm_results`. That shape is why it was
 * invisible to a photo search built on the other two corpora: there is no photo table to
 * query, so the slots have to be unpivoted into rows.
 *
 * It matters because it is the only corpus that can answer a question like "the after
 * photo showing the pole standing": QField classifies to a coarse `work_type`
 * (`pole_installation`), construction-QA has step labels but does not cover every
 * project, and this one has both the step label AND whether the VLM accepted it.
 */
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';

/**
 * Unpivot the slot columns into (slot, label, discipline, storage_key) rows.
 *
 * SLOT_META is a trusted in-code constant — no user input reaches this string, which is
 * the same reasoning pages/api/works-qa/poles.ts relies on for PRESENT_SLOTS_EXPR.
 * Labels are single-quote-escaped anyway so a future label containing an apostrophe
 * cannot break the statement.
 */
const SLOT_ROWS = SLOT_META.map(
  (s) =>
    `('${s.key}', '${s.label.replace(/'/g, "''")}', '${s.discipline}', w.${s.dbColumn})`,
).join(',\n          ');

export const WORKS_QA_SLOT_UNPIVOT = `
      CROSS JOIN LATERAL (VALUES
          ${SLOT_ROWS}
      ) AS slot(slot_key, slot_label, discipline, storage_key)`;

/**
 * The per-slot verdict, read out of the `vlm_results` jsonb. NULL when unscored.
 *
 * A human override needs NO special case here, and adding one is a bug: `pole-override.ts`
 * accepts `decision: 'pass' | 'fail'` and writes `valid: decision === 'pass'` alongside
 * `overridden_by`, so `valid` ALREADY carries the reviewer's decision in both directions.
 * Forcing TRUE whenever `overridden_by` is present silently converts an explicit FAIL
 * override into a pass — the photo then answers a "show me the failures" query with
 * nothing, hiding work a human deliberately rejected.
 *
 * Gated on `jsonb_typeof(...) = 'boolean'` rather than casting whatever is there. The
 * cast throws on any non-boolean, and because this expression appears in the shared
 * UNION, one malformed row anywhere in pole_qa_photos would 500 every photo search and
 * every download manifest for every project, not just the affected one.
 */
export const WORKS_QA_VLM_VALID = `
  CASE
    WHEN jsonb_typeof(w.vlm_results -> slot.slot_key -> 'valid') = 'boolean'
      THEN (w.vlm_results -> slot.slot_key ->> 'valid')::boolean
    ELSE NULL
  END`;
