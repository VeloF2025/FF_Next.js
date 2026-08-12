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
 * The per-slot VLM verdict, read out of the `vlm_results` jsonb.
 *
 * An overridden failure is NOT a failure: `pole-override.ts` records a human decision in
 * `overridden_by`, and reporting those as failures would tell a PM that work already
 * accepted by a reviewer is still outstanding.
 */
export const WORKS_QA_VLM_VALID = `
  CASE
    WHEN w.vlm_results -> slot.slot_key ->> 'overridden_by' IS NOT NULL THEN TRUE
    WHEN jsonb_exists(COALESCE(w.vlm_results -> slot.slot_key, '{}'::jsonb), 'valid')
      THEN (w.vlm_results -> slot.slot_key ->> 'valid')::boolean
    ELSE NULL
  END`;
