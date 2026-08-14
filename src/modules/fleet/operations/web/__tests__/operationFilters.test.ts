import { describe, expect, it } from 'vitest';
import {
  OperationFilterError,
  parseOperationFilters,
  serializeOperationFilters,
  type OperationFilters,
} from '../operationFilters';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';
const WORK_DATE = '2026-08-14';
const AS_OF = '2026-08-14T08:00:00.000Z';

describe('parseOperationFilters', () => {
  it('accepts valid project, staff, site, date, instant, status, and evidence filters', () => {
    const parsed = parseOperationFilters(new URLSearchParams({
      projectId: PROJECT,
      staffId: STAFF,
      siteId: SITE,
      workDate: WORK_DATE,
      asOf: AS_OF,
      status: 'late',
      evidence: 'vehicle_only',
    }));

    expect(parsed).toEqual({
      projectId: PROJECT,
      staffId: STAFF,
      siteId: SITE,
      workDate: WORK_DATE,
      asOf: AS_OF,
      status: 'late',
      evidence: 'vehicle_only',
    });
  });

  it.each([
    ['status', 'not_a_status'],
    ['group', 'not_a_group'],
    ['evidence', 'gps'],
    ['projectId', 'not-a-uuid'],
    ['staffId', 'not-a-uuid'],
    ['siteId', 'not-a-uuid'],
    ['workDate', '2026-02-30'],
    ['asOf', '2026-08-14T08:00:00'],
  ])('rejects an invalid %s value', (key, value) => {
    expect(() => parseOperationFilters(new URLSearchParams({ [key]: value })))
      .toThrow(OperationFilterError);
  });

  it.each([
    'on_site', 'approaching', 'late', 'wrong_site', 'mismatch', 'left_early',
    'unassigned', 'unverifiable', 'normal',
  ])('accepts the %s status group', (group) => {
    expect(parseOperationFilters(new URLSearchParams({ group }))).toEqual({ group });
  });

  it.each(['attendance_only', 'vehicle_only', 'dual', 'missing', 'stale'])(
    'accepts the %s evidence filter', (evidence) => {
      expect(parseOperationFilters(new URLSearchParams({ evidence }))).toEqual({ evidence });
    },
  );

  it('rejects unknown query parameters', () => {
    expect(() => parseOperationFilters('?projectId=' + PROJECT + '&debug=true'))
      .toThrowError(expect.objectContaining({ code: 'unknown_filter' }));
  });

  it('rejects repeated query parameters', () => {
    expect(() => parseOperationFilters(`?projectId=${PROJECT}&projectId=${PROJECT}`))
      .toThrowError(expect.objectContaining({ code: 'repeated_filter' }));
  });

  it('rejects simultaneous status and group selections', () => {
    expect(() => parseOperationFilters('?status=late&group=late'))
      .toThrowError(expect.objectContaining({ code: 'conflicting_filter' }));
  });
});

describe('serializeOperationFilters', () => {
  it('serializes recognized non-empty filters in stable canonical order', () => {
    const filters: OperationFilters = {
      evidence: 'dual',
      asOf: AS_OF,
      siteId: SITE,
      projectId: PROJECT,
      workDate: WORK_DATE,
      staffId: STAFF,
      group: 'wrong_site',
    };

    expect(serializeOperationFilters(filters)).toBe(
      `projectId=${PROJECT}&staffId=${STAFF}&siteId=${SITE}&workDate=${WORK_DATE}`
      + `&asOf=${encodeURIComponent(AS_OF)}&group=wrong_site&evidence=dual`,
    );
  });

  it('round-trips dashboard filters into the same map selection', () => {
    const dashboard: OperationFilters = {
      projectId: PROJECT,
      workDate: WORK_DATE,
      asOf: AS_OF,
      status: 'evidence_mismatch',
      evidence: 'dual',
    };

    expect(parseOperationFilters(serializeOperationFilters(dashboard))).toEqual(dashboard);
  });

  it('clears a selected status while retaining the remaining selection', () => {
    const selected: OperationFilters = { projectId: PROJECT, workDate: WORK_DATE, status: 'late' };
    const cleared: OperationFilters = { ...selected, status: undefined };

    expect(parseOperationFilters(serializeOperationFilters(cleared))).toEqual({
      projectId: PROJECT,
      workDate: WORK_DATE,
    });
  });
});
