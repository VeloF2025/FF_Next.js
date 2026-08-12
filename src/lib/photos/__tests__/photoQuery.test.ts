import { describe, expect, it } from 'vitest';

import {
  allKeysQuery,
  MAX_PAGE_SIZE,
  pageQuery,
  parseFilter,
  proxySourceForKey,
  summaryQuery,
  type PhotoFilter,
} from '../photoQuery';

function filter(over: Partial<PhotoFilter> = {}): PhotoFilter {
  return { source: 'both', limit: 25, offset: 0, ...over };
}

describe('parseFilter', () => {
  it('defaults to both corpora and a bounded page', () => {
    const parsed = parseFilter({});
    expect('filter' in parsed && parsed.filter.source).toBe('both');
    expect('filter' in parsed && parsed.filter.limit).toBe(25);
  });

  it('rejects an unknown source instead of silently searching everything', () => {
    expect(parseFilter({ source: 'payroll' })).toEqual({
      error: 'source must be qa, qfield or both — got "payroll"',
    });
  });

  it('rejects a non-pass/fail vlm value', () => {
    expect(parseFilter({ vlm: 'maybe' })).toHaveProperty('error');
  });

  it('rejects a non-integer zone rather than dropping the filter', () => {
    // Dropping it would widen the result set from one zone to the whole project.
    expect(parseFilter({ zone: '3.5' })).toHaveProperty('error');
    expect(parseFilter({ pon: 'abc' })).toHaveProperty('error');
  });

  it('rejects a date Postgres would reject, not just one Date.parse dislikes', () => {
    // Date.parse rolls 2026-02-30 over to March 2 and accepts a bare year; ::timestamptz
    // rejects both. Letting them through turns a bad parameter into a generic 500.
    expect(parseFilter({ from: 'last tuesday' })).toHaveProperty('error');
    expect(parseFilter({ from: '2026-02-30' })).toHaveProperty('error');
    expect(parseFilter({ to: '2026-13-01' })).toHaveProperty('error');
    expect(parseFilter({ from: '2026' })).toHaveProperty('error');
    expect(parseFilter({ from: '2026-06-15' })).toHaveProperty('filter');
    expect(parseFilter({ from: '2026-06-15T10:30:00Z' })).toHaveProperty('filter');
  });

  it('clamps page size so one call cannot pull the corpus', () => {
    const parsed = parseFilter({ limit: '100000' });
    expect('filter' in parsed && parsed.filter.limit).toBe(MAX_PAGE_SIZE);
    const negative = parseFilter({ limit: '-5', offset: '-1' });
    expect('filter' in negative && negative.filter.limit).toBe(1);
    expect('filter' in negative && negative.filter.offset).toBe(0);
  });

  it('treats needsRetake as a tri-state, not a boolean cast', () => {
    expect('filter' in parseFilter({}) && parseFilter({}).filter?.needsRetake).toBeUndefined();
    const t = parseFilter({ needsRetake: 'true' });
    expect('filter' in t && t.filter.needsRetake).toBe(true);
    const f = parseFilter({ needsRetake: 'false' });
    expect('filter' in f && f.filter.needsRetake).toBe(false);
  });
});

describe('proxySourceForKey', () => {
  it('routes projects/ keys to MinIO and the rest to local disk', () => {
    expect(proxySourceForKey('projects/uuid/files/DCIM/a.jpg')).toBe('qfield');
    expect(proxySourceForKey('etwatwa/ETW.P.F283/a.jpg')).toBe('local');
  });
});

/**
 * Every `$n` occurrence in the SQL, not just the distinct ones.
 *
 * The distinct set alone is too weak to see the failure this guards: if each UNION
 * branch numbered from $1 independently, the distinct max would STILL equal
 * params.length. Only the occurrence COUNT reveals the collision — each parameter is
 * pushed once and referenced once, so occurrences must equal params.length exactly.
 */
function placeholders(sql: string): { max: number; refs: Set<number>; occurrences: number } {
  const refs = new Set<number>();
  let occurrences = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) {
    refs.add(Number(m[1]));
    occurrences += 1;
  }
  return { max: refs.size ? Math.max(...refs) : 0, refs, occurrences };
}

describe('parameter numbering across the UNION', () => {
  // Both branch builders share ONE params array so $n runs continuously across the
  // UNION. Give either branch its own array and the second branch's placeholders bind
  // to the first branch's values — wrong rows, no error, green CI. Nothing else in this
  // file can see that, because the rest assert on SQL text.
  const shapes: Array<[string, Partial<PhotoFilter>]> = [
    ['no filters, both corpora', {}],
    ['fully populated, both corpora', {
      project: 'Etwatwa', type: 'depth', pole: 'ETW.P.F283', from: '2026-06-01', to: '2026-07-01',
    }],
    ['qa only', { source: 'qa', project: 'Etwatwa', type: 'depth', pole: 'x' }],
    ['qfield only', { source: 'qfield', project: 'Etwatwa', type: 'pole' }],
    ['uuid project', { project: 'de408530-76f0-4d10-bf08-cfcd3202f69e', type: 'depth' }],
    ['zone and pon', { project: 'Lawley', zone: 3, pon: 5 }],
  ];

  for (const [label, over] of shapes) {
    it(`binds every placeholder exactly once — ${label}`, () => {
      for (const build of [pageQuery, summaryQuery, allKeysQuery]) {
        const { sql, params } = build(filter(over));
        const { max, refs, occurrences } = placeholders(sql);
        expect(max).toBe(params.length);
        // Each param bound exactly once. Catches two branches both numbering from $1.
        expect(occurrences).toBe(params.length);
        // No gaps: $1..$max must all appear, or a value is silently unused.
        for (let i = 1; i <= max; i += 1) expect(refs.has(i)).toBe(true);
      }
    });
  }
});

describe('query construction', () => {
  it('parameterises every user value — no interpolation into SQL', () => {
    const { sql, params } = pageQuery(
      filter({ project: "Etwatwa'; DROP TABLE projects;--", type: 'depth', pole: 'x' }),
    );
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain("%Etwatwa'; DROP TABLE projects;--%");
  });

  it('matches a project by UUID without the name subquery', () => {
    const uuid = 'de408530-76f0-4d10-bf08-cfcd3202f69e';
    const { sql, params } = summaryQuery(filter({ project: uuid, source: 'qa' }));
    expect(sql).toContain('::uuid');
    expect(sql).not.toContain('project_name ILIKE');
    expect(params).toContain(uuid);
  });

  it('resolves the QField corpus through the key path, never its NULL project_id', () => {
    // Every row of qfield_photo_validations has project_id NULL, so filtering on that
    // column returns zero rows forever. The join must go via split_part on the key.
    const { sql } = summaryQuery(filter({ project: 'Etwatwa', source: 'qfield' }));
    expect(sql).toContain("split_part(q.photo_key, '/', 2)");
    expect(sql).toContain('qfield_project_links');
    expect(sql).not.toMatch(/q\.project_id\s*=/);
  });

  it('returns nothing from QField when asked for a zone it cannot have', () => {
    // Ignoring the filter instead would answer a narrow question with the whole project.
    const { sql } = summaryQuery(filter({ source: 'qfield', zone: 3 }));
    expect(sql).toContain('FALSE');
  });

  it('counts an unscored photo as neither pass nor fail', () => {
    // ~197 rows have vlm_valid NULL. IS NOT TRUE would file them as failures.
    expect(summaryQuery(filter({ source: 'qa', vlm: 'fail' })).sql).toContain('p.vlm_valid IS FALSE');
    expect(summaryQuery(filter({ source: 'qa', vlm: 'pass' })).sql).toContain('p.vlm_valid IS TRUE');
  });

  it('dedupes the ~102 keys present in both corpora', () => {
    const { sql } = pageQuery(filter({ project: 'Etwatwa' }));
    expect(sql).toContain('DISTINCT ON (storage_key)');
    expect(sql).toContain('UNION ALL');
  });

  it('sorts the page by recency outside the DISTINCT ON, not by key', () => {
    // DISTINCT ON dictates its own leading sort key. Without the outer ORDER BY,
    // "the 20 most recent photos" quietly returns the 20 alphabetically-first ones.
    const { sql } = pageQuery(filter());
    const inner = sql.indexOf('ORDER BY storage_key, corpus_rank, captured_at DESC');
    const outer = sql.indexOf('ORDER BY captured_at DESC NULLS LAST, storage_key');
    expect(inner).toBeGreaterThan(-1);
    expect(outer).toBeGreaterThan(inner);
  });

  it('reports how many matches actually have a known size', () => {
    // qfield rows carry no size at all; summing alone would report 0 MB for a 10,980
    // photo download.
    expect(summaryQuery(filter()).sql).toContain('count(file_size_bytes)::int AS sized');
  });

  it('tags which timestamp each corpus is reporting', () => {
    // QField's only timestamp is validated_at — the validation RUN time, not capture
    // time. Presenting them as one column silently answers "photos from August" with
    // June photos that were validated in August.
    const { sql } = pageQuery(filter());
    expect(sql).toContain("'captured'            AS date_basis");
    expect(sql).toContain("'validated'       AS date_basis");
  });

  it('excludes QField from a VLM filter instead of substituting needs_retake', () => {
    // qfield_photo_validations has no boolean verdict column. Answering "which photos
    // did the VLM fail" with the retake flag is a wrong answer, not a partial one — and
    // vlm='fail' + needsRetake=false compiled to `IS TRUE AND IS NOT TRUE`, always empty.
    const { sql } = summaryQuery(filter({ source: 'qfield', vlm: 'pass' }));
    expect(sql).toContain('FALSE');
    expect(sql).not.toContain('q.needs_retake IS NOT TRUE');
  });

  it('resolves a cross-corpus duplicate to the QA row, not by timestamp', () => {
    // ~102 keys exist in both corpora. A time-ordered tiebreak hands every one to the
    // QField row (validation always postdates capture), losing file_size_bytes,
    // vlm_valid, zone_no, pon_no and filename.
    const { sql } = pageQuery(filter());
    expect(sql).toContain('ORDER BY storage_key, corpus_rank, captured_at DESC NULLS LAST');
    expect(sql).toContain('0                     AS corpus_rank');
    expect(sql).toContain('1                 AS corpus_rank');
  });

  it('escapes LIKE wildcards so a filter cannot silently match everything', () => {
    // `project=%` would otherwise match every project — and a manifest has no size cap,
    // so a filter that cannot bound the result set is the whole ballgame.
    const { params } = summaryQuery(filter({ project: '%', source: 'qa' }));
    expect(params).toContain('%\\%%');
    const typed = summaryQuery(filter({ type: '_', source: 'qa' }));
    expect(typed.params).toContain('%\\_%');
  });

  it('applies no limit to the manifest query', () => {
    // Decision (Hein, 2026-08-12): existing RBAC, no ceiling on a download.
    const { sql } = allKeysQuery(filter({ project: 'Etwatwa' }));
    expect(sql).not.toContain('LIMIT');
  });
});
