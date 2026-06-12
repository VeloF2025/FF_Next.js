import { describe, it, expect } from 'vitest';
import { buildLedgerQuery, RECON_CLASSES } from '../reconLedgerQuery';

describe('buildLedgerQuery — pagination', () => {
  it('defaults to page 1, pageSize 50, offset 0 with no input', () => {
    const q = buildLedgerQuery({});
    expect(q).toMatchObject({ page: 1, pageSize: 50, offset: 0, whereClause: '', params: [] });
  });

  it('clamps pageSize to the 200 ceiling', () => {
    expect(buildLedgerQuery({ pageSize: '5000' }).pageSize).toBe(200);
  });

  it('clamps pageSize and page to a floor of 1 (incl. negatives)', () => {
    expect(buildLedgerQuery({ pageSize: '0' }).pageSize).toBe(1);
    expect(buildLedgerQuery({ pageSize: '-5' }).pageSize).toBe(1);
    expect(buildLedgerQuery({ page: '0' }).page).toBe(1);
    expect(buildLedgerQuery({ page: '-3' }).page).toBe(1);
  });

  it('computes offset from page and pageSize', () => {
    const q = buildLedgerQuery({ page: '3', pageSize: '25' });
    expect(q).toMatchObject({ page: 3, pageSize: 25, offset: 50 });
  });

  it('falls back to defaults on non-numeric paging', () => {
    const q = buildLedgerQuery({ page: 'abc', pageSize: 'xyz' });
    expect(q).toMatchObject({ page: 1, pageSize: 50 });
  });
});

describe('buildLedgerQuery — recon_class filter', () => {
  it.each(RECON_CLASSES)('binds a valid recon_class %s as $1', (cls) => {
    const q = buildLedgerQuery({ recon_class: cls });
    expect(q.whereClause).toBe('WHERE recon_class = $1');
    expect(q.params).toEqual([cls]);
  });

  it('ignores an unknown recon_class (no 400, no condition)', () => {
    const q = buildLedgerQuery({ recon_class: 'bogus_class' });
    expect(q.whereClause).toBe('');
    expect(q.params).toEqual([]);
  });

  it('ignores a SQL-injection attempt in recon_class', () => {
    const q = buildLedgerQuery({ recon_class: "all_agree'; DROP TABLE drops;--" });
    expect(q.whereClause).toBe('');
    expect(q.params).toEqual([]);
  });
});

describe('buildLedgerQuery — project + search', () => {
  it('binds an exact project filter', () => {
    const q = buildLedgerQuery({ project: 'Lawley' });
    expect(q.whereClause).toBe('WHERE project = $1');
    expect(q.params).toEqual(['Lawley']);
  });

  it('wraps search in ILIKE wildcards across all four serials + drop_number', () => {
    const q = buildLedgerQuery({ search: 'DR123' });
    expect(q.params).toEqual(['%DR123%']);
    expect(q.whereClause).toContain('drop_number ILIKE $1');
    expect(q.whereClause).toContain('wa_serial ILIKE $1');
    expect(q.whereClause).toContain('oes_serial ILIKE $1');
    expect(q.whereClause).toContain('onemap_serial ILIKE $1');
    expect(q.whereClause).toContain('drops_serial ILIKE $1');
  });

  it('trims whitespace and ignores blank project/search', () => {
    expect(buildLedgerQuery({ project: '   ' }).whereClause).toBe('');
    expect(buildLedgerQuery({ search: '   ' }).whereClause).toBe('');
    expect(buildLedgerQuery({ project: '  Lawley  ' }).params).toEqual(['Lawley']);
  });

  it('escapes LIKE wildcards so they match literally, not as wildcards', () => {
    expect(buildLedgerQuery({ search: '50%' }).params).toEqual(['%50\\%%']);
    expect(buildLedgerQuery({ search: 'a_b' }).params).toEqual(['%a\\_b%']);
    expect(buildLedgerQuery({ search: 'a\\b' }).params).toEqual(['%a\\\\b%']);
  });
});

describe('buildLedgerQuery — combined filters keep $-indices aligned', () => {
  it('numbers params in insertion order: recon_class, project, search', () => {
    const q = buildLedgerQuery({ recon_class: 'serial_other_dr', project: 'Mohadin', search: 'ALCLB' });
    expect(q.params).toEqual(['serial_other_dr', 'Mohadin', '%ALCLB%']);
    expect(q.whereClause).toBe(
      'WHERE recon_class = $1 AND project = $2 AND ' +
        '(drop_number ILIKE $3 OR wa_serial ILIKE $3 OR oes_serial ILIKE $3 OR onemap_serial ILIKE $3 OR drops_serial ILIKE $3)'
    );
  });

  it('uses only the first value when a param arrives as an array', () => {
    const q = buildLedgerQuery({ recon_class: ['wa_no_oes', 'all_agree'] });
    expect(q.params).toEqual(['wa_no_oes']);
  });
});
