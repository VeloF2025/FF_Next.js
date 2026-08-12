/**
 * The three section builders. Every fixture here is a real project shape measured on the
 * production database, because the failures worth guarding against are all cases where a
 * plausible number would have been wrong.
 */
import { describe, expect, it } from 'vitest';

import { buildSectionQuery, shapeBuildSection, type BuildSectionRow } from '../buildSection';
import { deliverySectionQuery, shapeDeliverySection, type DeliverySectionRow } from '../deliverySection';
import { qualitySectionQuery, shapeQualitySection, type QualitySectionRow } from '../qualitySection';

function buildRow(over: Partial<BuildSectionRow> = {}): BuildSectionRow {
  return {
    project_name: 'Test',
    status: 'active',
    name_matches: '1',
    pole_scope: '0',
    poles: '0',
    approved: '0',
    last_7d: '0',
    prior_7d: '0',
    slot_progress: null,
    weekly: null,
    ...over,
  };
}

function qualityRow(over: Partial<QualitySectionRow> = {}): QualitySectionRow {
  return {
    project_name: 'Test',
    status: 'active',
    name_matches: '1',
    pass: '0',
    fail: '0',
    unscored: '0',
    needs_retake: '0',
    snags_open: '0',
    snags_major: '0',
    snags_over_30d: '0',
    snags_over_90d: '0',
    snags_oldest: null,
    worst_slots: null,
    snags_by_status: null,
    ...over,
  };
}

function deliveryRow(over: Partial<DeliverySectionRow> = {}): DeliverySectionRow {
  return {
    project_name: 'Test',
    status: 'active',
    name_matches: '1',
    drops_scope: '0',
    activations: '0',
    last_7d: '0',
    prior_7d: '0',
    newest_activation: null,
    po_count: '0',
    po_value: '0',
    po_pending: '0',
    po_cancelled: '0',
    boq_items: '0',
    boq_value: '0',
    weekly: null,
    po_status: null,
    ...over,
  };
}

describe('every section', () => {
  it('parameterises the project name and escapes LIKE wildcards', () => {
    for (const q of [buildSectionQuery('%'), qualitySectionQuery('%'), deliverySectionQuery('%')]) {
      expect(q.sql).not.toContain("'%'");
      // The predicate is built twice — once for `target`, once for the match count.
      expect(q.params).toEqual(['%\\%%', '%\\%%']);
    }
  });

  it('carries the no-schedule caveat first, whatever it measures', () => {
    expect(shapeBuildSection(buildRow()).caveats[0]).toContain('no maintained schedule');
    expect(shapeQualitySection(qualityRow()).caveats[0]).toContain('no maintained schedule');
    expect(shapeDeliverySection(deliveryRow()).caveats[0]).toContain('no maintained schedule');
  });

  it('says which project it answered for when the name was ambiguous', () => {
    // "Thembisa" matches three; answering silently is how POP 1's numbers get read as POP 3's.
    for (const s of [
      shapeBuildSection(buildRow({ name_matches: '3' })),
      shapeQualitySection(qualityRow({ name_matches: '3' })),
      shapeDeliverySection(deliveryRow({ name_matches: '3' })),
    ]) {
      expect(s.caveats.join(' ')).toContain('one of 3 projects');
    }
  });
});

describe('build section', () => {
  it('measures completion against pole scope, never the drop count', () => {
    const s = shapeBuildSection(buildRow({ poles: '1493', pole_scope: '4538' }));
    expect(s.completion.percent).toBe(32.9);
  });

  it('names the capture funnel drop-off rather than only the pole count', () => {
    // Etwatwa: 1,171 poles have a Before Photo, 313 have a Pole Label. Those 858 poles
    // are part-captured, not unstarted, and the label step is where the process fails.
    const s = shapeBuildSection(
      buildRow({
        poles: '1493',
        slot_progress: [
          { slot: 'civil_01', label: 'Before Photo', discipline: 'civil', step: 1, polesWithPhoto: '1171' },
          { slot: 'civil_08', label: 'Pole Label', discipline: 'civil', step: 8, polesWithPhoto: '313' },
        ],
      }),
    );
    expect(s.caveats.join(' ')).toContain('drops from 1171 poles');
    expect(s.caveats.join(' ')).toContain('not poles that were never started');
  });

  it('does not claim a drop-off when capture is even', () => {
    const s = shapeBuildSection(
      buildRow({
        poles: '100',
        slot_progress: [
          { slot: 'civil_01', label: 'Before Photo', discipline: 'civil', step: 1, polesWithPhoto: '100' },
          { slot: 'civil_08', label: 'Pole Label', discipline: 'civil', step: 8, polesWithPhoto: '100' },
        ],
      }),
    );
    expect(s.caveats.join(' ')).not.toContain('drops from');
  });

  it('generates one slot row per photo slot from the trusted constant', () => {
    const { sql } = buildSectionQuery('Etwatwa');
    expect(sql).toContain('civil_step_07_key');
    expect(sql).toContain("'After Photo'");
    expect(sql).toContain('main_joint_16_key');
  });
});

describe('quality section', () => {
  it('reports unscored slots as their own category, never folded into the rate', () => {
    // Etwatwa: 2,813 / 3,989 / 5,757. A single pass rate over all three would describe
    // a project that does not exist.
    const s = shapeQualitySection(qualityRow({ pass: '2813', fail: '3989', unscored: '5757' }));
    expect(s.verdicts.neverScored.value).toBe(5757);
    expect(s.verdicts.passRateOfScored.of).toBe(6802);
    expect(s.verdicts.passRateOfScored.percent).toBe(41.4);
    expect(s.caveats.join(' ')).toContain('They are NOT passes');
  });

  it('detects an unscored slot with IS DISTINCT FROM, not <>', () => {
    // jsonb_typeof is NULL for an absent key and NULL <> 'boolean' is NULL, so a plain
    // <> silently reports zero unscored slots for every project.
    const { sql } = qualitySectionQuery('Etwatwa');
    expect(sql).toContain("vtype IS DISTINCT FROM 'boolean'");
    expect(sql).not.toMatch(/vtype <> 'boolean'/);
  });

  it('counts a snag with no status as outstanding rather than dropping it', () => {
    const { sql } = qualitySectionQuery('Etwatwa');
    expect(sql).toContain("COALESCE(status, 'open') NOT IN ('verified', 'closed')");
  });

  it('flags a long-standing snag backlog', () => {
    const s = shapeQualitySection(qualityRow({ snags_open: '457', snags_over_90d: '428' }));
    expect(s.caveats.join(' ')).toContain('428 outstanding snags are more than 90 days old');
  });

  it('reads the verdict through a type guard so one bad row cannot break the report', () => {
    const { sql } = qualitySectionQuery('Etwatwa');
    expect(sql).toContain("jsonb_typeof(v.value -> 'valid')");
  });
});

describe('delivery section', () => {
  it('measures activations against drops, and withholds when drops are absent', () => {
    // Grabouw: 3,793 poles in scope, no drops at all.
    const s = shapeDeliverySection(deliveryRow({ activations: '0', drops_scope: '0' }));
    expect(s.activations.completion.percent).toBeNull();
    expect(s.caveats.join(' ')).toContain('not evidence that nothing has been activated');
  });

  it('reports a real activation percentage when drops exist', () => {
    // Mohadin: 8,861 of 22,174.
    const s = shapeDeliverySection(deliveryRow({ activations: '8861', drops_scope: '22174' }));
    expect(s.activations.completion.percent).toBe(40);
  });

  it('casts the BOQ project id, which is varchar where every sibling is uuid', () => {
    // Without the cast Postgres refuses: operator does not exist: character varying = uuid.
    const { sql } = deliverySectionQuery('Etwatwa');
    expect(sql).toContain('SELECT id::text FROM target');
  });

  it('withholds procurement figures from a caller without that permission', () => {
    // PO totals and BOQ values are financial. contractor and storeman are explicitly
    // denied `procurement` view and technician/viewer hold no row at all — yet all four
    // hold the `projects` view that gates this route.
    const s = shapeDeliverySection(
      deliveryRow({ po_count: '108', po_value: '16882648', boq_items: '250', po_pending: '2' }),
      false,
    );
    expect(s.procurement).toBeUndefined();
    expect(s.procurementWithheld).toContain('procurement permission');
    // The activation half is legitimately theirs and must survive.
    expect(s.activations).toBeDefined();
    // The pending-approval caveat leaks a procurement fact and must go too.
    expect(s.caveats.join(' ')).not.toContain('awaiting approval');
  });

  it('returns procurement figures to a caller who holds the permission', () => {
    const s = shapeDeliverySection(
      deliveryRow({ po_count: '108', po_value: '16882648' }),
      true,
    );
    expect(s.procurement?.purchaseOrders.value).toBe(108);
    expect(s.procurement?.totalValue).toBe(16882648);
    expect(s.procurementWithheld).toBeUndefined();
  });

  it('surfaces purchase orders waiting on approval', () => {
    const s = shapeDeliverySection(deliveryRow({ po_pending: '2' }));
    expect(s.caveats.join(' ')).toContain('2 purchase orders are awaiting approval');
  });
});
