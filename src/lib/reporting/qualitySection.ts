/**
 * QA quality and outstanding snags — the two questions a PM asks when work is being
 * handed over rather than counted.
 *
 * Verdicts are reported PER SLOT and split three ways. A pole holds up to 22 photos and
 * can pass some while failing others, so a pole-level verdict hides the failures inside
 * it; and an unscored slot is not a pass. Etwatwa has 2,813 passes, 3,989 failures and
 * 5,757 slots the VLM never judged — collapsing those to a single "pass rate" would
 * describe a project that does not exist.
 */
import { measure, ratio, type Measure, type Ratio } from './coverage';
import { baseCaveats, CANONICAL_SLOT_KEYS_SQL, targetCte } from './projectTarget';

/**
 * Read a slot's verdict out of `vlm_results`.
 *
 * `jsonb_typeof(...) = 'boolean'` rather than a bare cast: the cast throws on any
 * non-boolean value, and one malformed row would take the whole report down. A human
 * override needs no special case — pole-override.ts writes `valid: decision === 'pass'`,
 * so `valid` already carries the reviewer's decision in both directions.
 */
const VERDICT = `jsonb_typeof(v.value -> 'valid')`;

export function qualitySectionQuery(project: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  return {
    params,
    sql: `
      WITH ${targetCte(project, params)},
      slots AS (
        SELECT v.key AS slot, (v.value ->> 'valid') AS raw_valid, ${VERDICT} AS vtype
        FROM pole_qa_photos w
        CROSS JOIN LATERAL jsonb_each(COALESCE(w.vlm_results, '{}'::jsonb)) AS v(key, value)
        WHERE w.project_id = (SELECT id FROM target)
          -- Canonical slots only. The column also holds legacy optical_dome_NN keys
          -- duplicating dome_NN (2,345 of them, NONE ever scored, so all landed in
          -- "never scored" and inflated it — 38% of Mamelodi's count) plus
          -- tray_<uuid> and unassigned_<uuid> keys that were surfacing beside civil_05
          -- as failing build steps.
          AND v.key = ANY(${CANONICAL_SLOT_KEYS_SQL})
      ),
      verdicts AS (
        SELECT
          count(*) FILTER (WHERE vtype = 'boolean' AND raw_valid = 'true')::bigint  AS pass,
          count(*) FILTER (WHERE vtype = 'boolean' AND raw_valid = 'false')::bigint AS fail,
          -- IS DISTINCT FROM: jsonb_typeof is NULL for an absent key, and NULL <> 'boolean'
          -- is NULL, so a plain <> silently reports zero unscored slots.
          count(*) FILTER (WHERE vtype IS DISTINCT FROM 'boolean')::bigint          AS unscored
        FROM slots
      ),
      -- Which STEP fails most. This is the actionable number: five failures spread over
      -- five steps is noise, five on one step is a crew doing one thing wrong.
      by_slot AS (
        SELECT slot,
               count(*) FILTER (WHERE vtype = 'boolean' AND raw_valid = 'false')::bigint AS failed,
               count(*) FILTER (WHERE vtype = 'boolean')::bigint                          AS scored
        FROM slots GROUP BY 1 HAVING count(*) FILTER (WHERE vtype = 'boolean' AND raw_valid = 'false') > 0
        ORDER BY 2 DESC LIMIT 10
      ),
      retakes AS (
        SELECT count(*)::bigint n FROM construction_qa_photos
        WHERE project_id = (SELECT id FROM target) AND needs_retake IS TRUE
      ),
      -- COALESCE, not a bare NOT IN: status is nullable and NOT IN is NULL-inert, so an
      -- unknown status would vanish from the outstanding count instead of surfacing.
      snag_totals AS (
        SELECT count(*)::bigint AS open,
               count(*) FILTER (WHERE severity = 'major')::bigint AS major,
               count(*) FILTER (WHERE created_at < now() - interval '30 days')::bigint AS over_30d,
               count(*) FILTER (WHERE created_at < now() - interval '90 days')::bigint AS over_90d,
               min(created_at) AS oldest
        FROM snags
        WHERE project_id = (SELECT id FROM target)
          AND COALESCE(status, 'open') NOT IN ('verified', 'closed')
      ),
      snag_by_status AS (
        SELECT COALESCE(status, 'unknown') AS status, count(*)::bigint AS n
        FROM snags WHERE project_id = (SELECT id FROM target)
        GROUP BY 1 ORDER BY 2 DESC
      )
      SELECT t.project_name, t.status, m.n AS name_matches,
             verdicts.pass, verdicts.fail, verdicts.unscored,
             retakes.n AS needs_retake,
             snag_totals.open AS snags_open, snag_totals.major AS snags_major,
             snag_totals.over_30d AS snags_over_30d, snag_totals.over_90d AS snags_over_90d,
             snag_totals.oldest AS snags_oldest,
             (SELECT json_agg(json_build_object('slot', slot, 'failed', failed, 'scored', scored) ORDER BY failed DESC)
                FROM by_slot) AS worst_slots,
             (SELECT json_agg(json_build_object('status', status, 'count', n) ORDER BY n DESC)
                FROM snag_by_status) AS snags_by_status
      FROM target t, matches m, verdicts, retakes, snag_totals`,
  };
}

export interface QualitySectionRow {
  project_name: string;
  status: string | null;
  name_matches: string;
  pass: string;
  fail: string;
  unscored: string;
  needs_retake: string;
  snags_open: string;
  snags_major: string;
  snags_over_30d: string;
  snags_over_90d: string;
  snags_oldest: string | null;
  worst_slots: Array<{ slot: string; failed: string | number; scored: string | number }> | null;
  snags_by_status: Array<{ status: string; count: string | number }> | null;
}

export interface QualitySection {
  project: string;
  verdicts: { passed: Measure; failed: Measure; neverScored: Measure; passRateOfScored: Ratio };
  worstSlots: Array<{ slot: string; failed: number; scored: number }>;
  needsRetake: Measure;
  snags: {
    outstanding: Measure;
    major: Measure;
    olderThan30Days: Measure;
    olderThan90Days: Measure;
    oldestOpenedAt: string | null;
    byStatus: Array<{ status: string; count: number }>;
  };
  caveats: string[];
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

export function shapeQualitySection(row: QualitySectionRow): QualitySection {
  const pass = n(row.pass);
  const fail = n(row.fail);
  const unscored = n(row.unscored);
  const caveats = baseCaveats(row.project_name, n(row.name_matches));

  if (unscored > 0) {
    caveats.push(
      `${unscored} photo slots were never scored by the VLM. They are NOT passes — the ` +
        `pass rate below is of the ${pass + fail} that were judged, not of all ${pass + fail + unscored}.`,
    );
  }
  if (n(row.snags_over_90d) > 0) {
    caveats.push(
      `${row.snags_over_90d} outstanding snags are more than 90 days old.`,
    );
  }

  return {
    project: row.project_name,
    verdicts: {
      passed: measure(pass),
      failed: measure(fail),
      neverScored: measure(unscored),
      passRateOfScored: ratio(pass, pass + fail, row.status),
    },
    worstSlots: (row.worst_slots ?? []).map((s) => ({
      slot: s.slot,
      failed: n(s.failed),
      scored: n(s.scored),
    })),
    needsRetake: measure(n(row.needs_retake)),
    snags: {
      outstanding: measure(n(row.snags_open)),
      major: measure(n(row.snags_major)),
      olderThan30Days: measure(n(row.snags_over_30d)),
      olderThan90Days: measure(n(row.snags_over_90d)),
      oldestOpenedAt: row.snags_oldest,
      byStatus: (row.snags_by_status ?? []).map((s) => ({ status: s.status, count: n(s.count) })),
    },
    caveats,
  };
}
