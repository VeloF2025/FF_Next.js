import { describe, expect, it } from 'vitest';

import { overviewQuery, shapeOverview, type OverviewRow } from '../projectOverview';

/** A row shaped like the query's output, defaulting to an empty project. */
function row(over: Partial<OverviewRow> = {}): OverviewRow {
  return {
    project_id: 'uuid-1',
    project_name: 'Test',
    status: 'active',
    start_date: null,
    end_date: null,
    sow_drops: '0',
    poles: '0',
    poles_after_photo: '0',
    poles_approved: '0',
    poles_last_7d: '0',
    poles_prior_7d: '0',
    works_qa_photos: '0',
    newest_pole_at: null,
    qa_photos: '0',
    qfield_photos: '0',
    vlm_pass: '0',
    vlm_fail: '0',
    vlm_unscored: '0',
    activations: '0',
    activations_last_7d: '0',
    open_snags: '0',
    purchase_orders: '0',
    ...over,
  };
}

describe('overviewQuery', () => {
  it('parameterises the project and escapes LIKE wildcards', () => {
    // `project=%` must not match every project — a report is worthless if its subject
    // can silently become "all of them".
    const { sql, params } = overviewQuery('%');
    expect(sql).not.toContain("'%'");
    expect(params).toEqual(['%\\%%']);
  });

  it('matches a UUID without the name subquery', () => {
    const { sql, params } = overviewQuery('de408530-76f0-4d10-bf08-cfcd3202f69e');
    expect(sql).toContain('::uuid');
    expect(sql).not.toContain('ILIKE');
    expect(params).toEqual(['de408530-76f0-4d10-bf08-cfcd3202f69e']);
  });

  it('resists SQL injection through the project name', () => {
    const { sql, params } = overviewQuery("x'; DROP TABLE projects;--");
    expect(sql).not.toContain('DROP TABLE');
    expect(params[0]).toContain('DROP TABLE');
  });

  it('reaches QField and activations through their join paths, not a project_id column', () => {
    // Neither store has a usable project_id: QField's is NULL on all 60k rows, and
    // oes_activations has no such column at all.
    const { sql } = overviewQuery('Etwatwa');
    expect(sql).toContain("split_part(q.photo_key, '/', 2)");
    expect(sql).toContain('JOIN drops d ON d.id = a.drop_id');
  });

  it('counts VLM verdicts per slot, not per pole', () => {
    // One pole holds up to 22 photos and can pass some while failing others; counting
    // per pole would hide the failures inside a "passed" pole.
    const { sql } = overviewQuery('Etwatwa');
    expect(sql).toContain('jsonb_each');
    expect(sql).toContain("jsonb_typeof(v.value -> 'valid') = 'boolean'");
  });

  it('aggregates each store in its own CTE rather than joining them', () => {
    // drops holds 180k rows and pole_qa_photos 15k; joining them directly ran for two
    // minutes before being killed.
    const { sql } = overviewQuery('Etwatwa');
    for (const cte of ['sow AS', 'wq AS', 'verdicts AS', 'cqa AS', 'qf AS', 'act AS']) {
      expect(sql).toContain(cte);
    }
  });
});

describe('shapeOverview', () => {
  it('withholds completion and explains itself when scope was never imported', () => {
    // Tonga's real shape.
    const o = shapeOverview(row({ poles: '1360', sow_drops: '0', poles_approved: '1291' }));
    expect(o.build.completion.percent).toBeNull();
    expect(o.build.completion.absent).toBe('no-scope-recorded');
    expect(o.caveats.join(' ')).toContain('No SOW scope is imported');
  });

  it('flags scope with no capture as ambiguous rather than as zero progress', () => {
    // Thembisa POP 2's real shape.
    const o = shapeOverview(row({ sow_drops: '30682', poles: '0', status: 'planning' }));
    expect(o.build.completion.percent).toBe(0);
    expect(o.caveats.join(' ')).toContain('may mean work has not started');
  });

  it('warns that approval-gated exports return nothing when nothing is approved', () => {
    // Namakgale: 124 poles, 0 approved — the reason pon-zip refused.
    const o = shapeOverview(row({ poles: '124', poles_approved: '0' }));
    expect(o.caveats.join(' ')).toContain('include unapproved poles');
  });

  it('does not warn about approvals when poles are approved', () => {
    const o = shapeOverview(row({ poles: '124', poles_approved: '124' }));
    expect(o.caveats.join(' ')).not.toContain('include unapproved poles');
  });

  it('always carries the no-schedule caveat first', () => {
    // Every answer must state it; a PM must never read these actuals as plan variance.
    const o = shapeOverview(row());
    expect(o.caveats[0]).toContain('no maintained schedule');
  });

  it('computes the quality pass rate over scored slots only', () => {
    // Unscored slots are not failures — dividing by every slot would understate quality.
    const o = shapeOverview(row({ vlm_pass: '30', vlm_fail: '10', vlm_unscored: '60' }));
    expect(o.quality.passRate.percent).toBe(75);
    expect(o.quality.passRate.of).toBe(40);
  });

  it('reports photo totals per store and does not pretend they are deduplicated', () => {
    // 3,575 keys are shared between construction-QA and works-QA, so the total is an
    // upper bound and the per-store figures are the honest ones.
    const o = shapeOverview(row({ works_qa_photos: '100', qa_photos: '80', qfield_photos: '20' }));
    expect(o.photos.worksQa.value).toBe(100);
    expect(o.photos.total).toBe(200);
  });
});
