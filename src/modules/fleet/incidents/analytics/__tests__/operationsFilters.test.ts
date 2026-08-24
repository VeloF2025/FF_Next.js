import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_MONTHS, OperationsFilterError, hasRetainedOnlyFilter, parseOperationsFilters,
} from '../operationsFilters';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const VEHICLE = '44444444-4444-4444-8444-444444444444';

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
    expect(parseOperationsFilters({ op_start: '2026-01-15', op_end: '2026-12-15' }).start).toBe('2026-01-15');
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

describe('retained-only filters', () => {
  it('recognises the two that name one person or one vehicle', () => {
    expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, op_driver: DRIVER }))).toBe(true);
    expect(hasRetainedOnlyFilter(parseOperationsFilters({ ...range, op_vehicle: VEHICLE }))).toBe(true);
  });

  it('does not count the group filters', () => {
    expect(hasRetainedOnlyFilter(parseOperationsFilters({
      ...range, op_project: PROJECT, op_site: SITE, op_type: 'late',
    }))).toBe(false);
  });
});
