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

  it('rejects an unparseable date', () => {
    expect(parseFilter({ from: 'last tuesday' })).toHaveProperty('error');
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
    const inner = sql.indexOf('ORDER BY storage_key, captured_at DESC');
    const outer = sql.indexOf('ORDER BY captured_at DESC NULLS LAST, storage_key');
    expect(inner).toBeGreaterThan(-1);
    expect(outer).toBeGreaterThan(inner);
  });

  it('reports how many matches actually have a known size', () => {
    // qfield rows carry no size at all; summing alone would report 0 MB for a 10,980
    // photo download.
    expect(summaryQuery(filter()).sql).toContain('count(file_size_bytes)::int AS sized');
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
