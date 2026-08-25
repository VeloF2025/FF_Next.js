import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_MONTHS, OperationsFilterError, hasRetainedOnlyFilter, parseOperationsFilters,
  hasIncidentShapedFilter, retainedOnlyFilterNames,
} from '../operationsFilters';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const VEHICLE = '44444444-4444-4444-8444-444444444444';
const MANAGER = '55555555-5555-4555-8555-555555555555';

const range = { op_start: '2026-01-01', op_end: '2026-03-31' };

describe('the range', () => {
  it('requires both ends', () => {
    expect(() => parseOperationsFilters({ op_end: '2026-03-31' })).toThrow(/op_start is required/);
    expect(() => parseOperationsFilters({ op_start: '2026-01-01' })).toThrow(/op_end is required/);
  });

  it('refuses anything that is not a calendar date', () => {
    expect(() => parseOperationsFilters({ ...range, op_start: '01/01/2026' })).toThrow(OperationsFilterError);
    expect(() => parseOperationsFilters({ ...range, op_start: '2026-13-01' })).toThrow(OperationsFilterError);
    expect(() => parseOperationsFilters({ ...range, op_start: '2026-01-01T00:00:00Z' })).toThrow(OperationsFilterError);
  });

  it('refuses an end before its start', () => {
    expect(() => parseOperationsFilters({ op_start: '2026-03-01', op_end: '2026-01-01' }))
      .toThrow(/op_end cannot be before op_start/);
  });

  it('refuses a range wider than the month limit, and says how wide it was', () => {
    expect(() => parseOperationsFilters({ op_start: '2026-01-01', op_end: '2027-01-31' }))
      .toThrow(new RegExp(`at most ${MAX_RANGE_MONTHS} months, and this one covers 13`));
  });

  it('allows a range exactly at the limit', () => {
    expect(parseOperationsFilters({ op_start: '2026-01-15', op_end: '2026-12-15' }).start).toBe('2026-01-01');
  });

  it('answers in whole months, and says so by widening the range it echoes', () => {
    // Every figure behind this range is a monthly aggregate or a month derived
    // from facts, so a mid-month bound is not honoured and must not be echoed
    // back as though it were: a reader comparing `start` to the numbers would
    // otherwise believe the first half of January was excluded.
    const filters = parseOperationsFilters({ op_start: '2026-01-15', op_end: '2026-03-04' });
    expect(filters).toMatchObject({ start: '2026-01-01', end: '2026-03-31' });
  });

  it('lands on the real last day of a short month, leap years included', () => {
    expect(parseOperationsFilters({ op_start: '2024-02-10', op_end: '2024-02-10' }).end).toBe('2024-02-29');
    expect(parseOperationsFilters({ op_start: '2026-02-10', op_end: '2026-02-10' }).end).toBe('2026-02-28');
  });
});

describe('the optional filters', () => {
  it('accepts the full set', () => {
    const filters = parseOperationsFilters({
      ...range, op_project: PROJECT, op_site: SITE, op_driver: DRIVER, op_vehicle: VEHICLE,
      op_type: 'late', op_severity: 'high', op_outcome: 'confirmed', op_evidence: 'true',
    });
    expect(filters).toMatchObject({
      projectId: PROJECT, operationalSiteId: SITE, staffId: DRIVER, vehicleId: VEHICLE,
      incidentType: 'late', severity: 'high', outcome: 'confirmed', evidenceAvailable: true,
    });
  });

  it('refuses a value outside the closed set rather than ignoring it', () => {
    // Dropping it would widen the result, and the number would answer a
    // different question than the one asked.
    expect(() => parseOperationsFilters({ ...range, op_type: 'sleeping' })).toThrow(/op_type must be one of/);
    expect(() => parseOperationsFilters({ ...range, op_severity: 'urgent' })).toThrow(/op_severity/);
    expect(() => parseOperationsFilters({ ...range, op_outcome: 'maybe' })).toThrow(/op_outcome/);
  });

  it('refuses an id that is not a UUID', () => {
    expect(() => parseOperationsFilters({ ...range, op_project: 'lawley' })).toThrow(/op_project must be a UUID/);
  });

  it('refuses a boolean that is not true or false', () => {
    expect(() => parseOperationsFilters({ ...range, op_evidence: '1' })).toThrow(/op_evidence must be true or false/);
  });

  it('refuses a repeated parameter instead of taking the first', () => {
    expect(() => parseOperationsFilters({ ...range, op_project: [PROJECT, SITE] }))
      .toThrow(/op_project must be given at most once/);
  });

  it('treats an empty value as absent', () => {
    expect(parseOperationsFilters({ ...range, op_project: '' })).not.toHaveProperty('projectId');
  });

  it('omits an absent filter rather than setting it undefined', () => {
    // The filters travel back out on the response, where a present-but-undefined
    // key reads as "considered and empty" instead of "never asked".
    expect(Object.keys(parseOperationsFilters(range)).sort()).toEqual(['end', 'start']);
  });

  it('keeps the op_ prefix, so a queue deep link cannot pre-filter analytics', () => {
    expect(parseOperationsFilters({ ...range, projectId: PROJECT })).not.toHaveProperty('projectId');
  });
});

describe('op_manager', () => {
  it('parses as a manager user id', () => {
    expect(parseOperationsFilters({ ...range, op_manager: MANAGER })).toMatchObject({ managerUserId: MANAGER });
  });

  it('refuses to be combined with op_site, which already names one project', () => {
    // op_manager narrows to the projects one person manages; a site sits inside
    // exactly one project, so the pair is either redundant or contradictory, and
    // answering it would mean guessing which the caller meant.
    expect(() => parseOperationsFilters({ ...range, op_manager: MANAGER, op_site: SITE }))
      .toThrow(/op_manager cannot be combined with op_site/);
  });
});

describe('retained-only filters', () => {
  it('recognises the two that name one person or one vehicle', () => {
    expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, op_driver: DRIVER }))).toBe(true);
    expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, op_vehicle: VEHICLE }))).toBe(true);
  });

  it('counts every filter that names an attribute of one incident', () => {
    // An aggregate row has a project and a site and nothing else, so none of
    // these survives into a monthly count.
    for (const filter of [
      { op_type: 'late' }, { op_severity: 'high' }, { op_outcome: 'confirmed' }, { op_evidence: 'true' },
    ]) {
      expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, ...filter }))).toBe(true);
    }
  });

  it('counts op_site, which the published view has no row for', () => {
    // Organisation and project rows only. A site answered from its project's
    // row would cover every other site in that project.
    expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, op_site: SITE }))).toBe(true);
  });

  it('does not count op_project, which the view does publish', () => {
    expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, op_project: PROJECT }))).toBe(false);
  });

  it('leaves op_site out of the incident-shaped set, which decides fact kinds', () => {
    // Every fact carries a site, so a site filter narrows presence and monitor
    // runs rather than making them inapplicable.
    expect(hasIncidentShapedFilter(parseOperationsFilters({ ...range, op_site: SITE }))).toBe(false);
    expect(hasIncidentShapedFilter(parseOperationsFilters({ ...range, op_type: 'late' }))).toBe(true);
  });

  it('names the filters that were actually given, in a stable order', () => {
    expect(retainedOnlyFilterNames(parseOperationsFilters({
      ...range, op_severity: 'high', op_driver: DRIVER,
    }))).toEqual(['op_driver', 'op_severity']);
  });
});

describe('an op_ key this endpoint does not know', () => {
  it('is refused, and named, rather than quietly discarded', () => {
    // A typo'd filter that is dropped returns every severity under a heading
    // that says one. The header promises this; it was not enforced.
    expect(() => parseOperationsFilters({ ...range, op_sevrity: 'high' }))
      .toThrow(/op_sevrity is not a filter this endpoint accepts/);
  });

  it('lists the filters that are accepted, so the caller can fix it', () => {
    expect(() => parseOperationsFilters({ ...range, op_nonsense: 'x' }))
      .toThrow(/op_start, op_end, op_project/);
  });

  it('names every unknown key, not just the first', () => {
    expect(() => parseOperationsFilters({ ...range, op_alpha: '1', op_beta: '2' }))
      .toThrow(/op_alpha, op_beta are not filters/);
  });

  it('accepts every key it does know', () => {
    expect(() => parseOperationsFilters({
      ...range, op_project: PROJECT, op_driver: DRIVER, op_vehicle: VEHICLE,
      op_type: 'late', op_severity: 'high', op_outcome: 'confirmed', op_evidence: 'true',
    })).not.toThrow();
    expect(() => parseOperationsFilters({ ...range, op_manager: MANAGER })).not.toThrow();
    expect(() => parseOperationsFilters({ ...range, op_site: SITE })).not.toThrow();
  });

  it('leaves keys outside the op_ namespace alone', () => {
    // The drill-down carries `cursor`, and the router adds its own; refusing
    // those would break callers over parameters this parser never owned.
    expect(() => parseOperationsFilters({ ...range, cursor: 'abc', projectId: PROJECT })).not.toThrow();
  });

  it('refuses the unknown key before validating any value', () => {
    // Otherwise a request with both a typo and a bad date reports the date and
    // the caller fixes that, resubmits, and is still silently unfiltered.
    expect(() => parseOperationsFilters({ op_start: 'January', op_end: '2026-03-31', op_typo: '1' }))
      .toThrow(/op_typo/);
  });
});
