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
    pole_scope: '0',
    name_matches: '1',
    poles: '0',
    poles_in_plan: '0',
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
  });

  it('detects an unscored slot with IS DISTINCT FROM, not <>', () => {
    // jsonb_typeof is NULL when the key is absent, and `NULL <> 'boolean'` is NULL, so
    // the FILTER never matched: unscored was structurally always 0. Etwatwa's real
    // figure is 5,757 — a report claiming everything was scored is the exact failure
    // this module exists to prevent.
    const { sql } = overviewQuery('Etwatwa');
    expect(sql).toContain("jsonb_typeof(v.value -> 'valid') IS DISTINCT FROM 'boolean'");
    expect(sql).not.toMatch(/jsonb_typeof\(v\.value -> 'valid'\) <> 'boolean'/);
  });

  it('takes the build denominator from poles and the activation one from drops', () => {
    // They differ by ~4x. Dividing poles built by drops reported Etwatwa at 7.1% where
    // the truth is 32.9%, and Tonga as "no scope imported" where it is 61.8% built.
    const { sql } = overviewQuery('Etwatwa');
    expect(sql).toContain('pole_scope AS (');
    expect(sql).toContain('FROM poles pl');
    expect(sql).toContain("pl.status IS DISTINCT FROM 'cancelled'");
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
  it('withholds build completion when no POLE scope is imported', () => {
    const o = shapeOverview(
      row({ poles: '1360', poles_in_plan: '1360', pole_scope: '0', poles_approved: '1291' }),
    );
    expect(o.build.completion.percent).toBeNull();
    expect(o.build.completion.absent).toBe('no-scope-recorded');
    expect(o.caveats.join(' ')).toContain('no pole scope is imported');
  });

  it('divides poles by POLE scope, never by the drop count', () => {
    // Etwatwa's real shape: 1,493 captured, 4,538 poles in scope, 21,008 drops.
    // Using drops reported 7.1% where the truth is 32.9% — wrong by ~4x, pessimistically.
    const o = shapeOverview(
      row({ poles: '1493', poles_in_plan: '1480', pole_scope: '4538', sow_drops: '21008' }),
    );
    // Plan-matched numerator: 1,480 of Etwatwa's 1,493 captures match a live pole.
    expect(o.build.completion.percent).toBe(32.6);
    expect(o.build.completion.of).toBe(4538);
    // Activations keep drops as their denominator — they are a different scope.
    const withActs = shapeOverview(row({ activations: '1382', sow_drops: '21008', pole_scope: '4538' }));
    expect(withActs.activations.completion.of).toBe(21008);
  });

  it('says which project it answered for when the name was ambiguous', () => {
    // "Thembisa" matches three projects; silently returning the first is how a PM reads
    // POP 1's numbers as POP 3's.
    const o = shapeOverview(row({ project_name: 'Thembisa POP 1', name_matches: '3' }));
    expect(o.caveats.join(' ')).toContain('one of 3 projects');
  });

  it('does not raise ambiguity when exactly one project matched', () => {
    expect(shapeOverview(row()).caveats.join(' ')).not.toContain('one of');
  });

  it('flags scope with no capture as ambiguous rather than as zero progress', () => {
    // Thembisa POP 2's real shape.
    const o = shapeOverview(row({ pole_scope: '5000', poles: '0', status: 'planning' }));
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
