import { describe, expect, it } from 'vitest';

import { buildOperationalOverview } from '../overviewService';
import type { OperationalAttentionRow, OperationalStatusGroup } from '../presentationTypes';
import type { OperationalStatusSummary } from '../types';

type AssertNever<Value extends never> = Value;
type NoCoordinateKeys = AssertNever<Extract<keyof OperationalAttentionRow, 'lat' | 'lon' | 'coordinates' | 'geometry'>>;
const coordinateFreeContract: NoCoordinateKeys = undefined as never;

const summary = (status: OperationalStatusSummary['status']): OperationalStatusSummary => ({
  staffId: `staff-${status}`,
  staffName: `Staff ${status}`,
  projectId: 'project-1',
  projectName: 'Project One',
  operationalSiteId: 'site-1',
  operationalSiteName: 'Site One',
  status,
  flags: [],
  reasonCodes: ['test_reason'],
  monitoringStart: '2026-08-14T05:00:00.000Z',
  scheduledStart: '2026-08-14T06:00:00.000Z',
  graceEnd: '2026-08-14T06:15:00.000Z',
  scheduledEnd: '2026-08-14T15:00:00.000Z',
  monitoringEnd: '2026-08-14T16:00:00.000Z',
  gpsStaleAfterSeconds: 7200,
  sourceTimestamps: ['2026-08-14T08:00:00.000Z'],
  ruleId: 'rule-1',
  ruleVersion: 3,
});

const result = (items: OperationalStatusSummary[]) => ({
  items,
  page: 1,
  limit: 100,
  total: items.length,
  hasMore: false,
});

describe('buildOperationalOverview', () => {
  it.each<[OperationalStatusSummary['status'], OperationalStatusGroup]>([
    ['on_site_dual', 'on_site'],
    ['attendance_confirmed', 'on_site'],
    ['vehicle_on_site_driver_unconfirmed', 'unverifiable'],
    ['evidence_mismatch', 'mismatch'],
    ['wrong_site', 'wrong_site'],
    ['late', 'late'],
    ['left_early', 'left_early'],
    ['unassigned', 'unassigned'],
    ['unverifiable', 'unverifiable'],
    ['approaching', 'approaching'],
  ])('groups %s as %s', (status, expectedGroup) => {
    const overview = buildOperationalOverview(result([summary(status)]), { page: 1, limit: 25 });

    expect(overview.groups).toEqual([{ group: expectedGroup, count: 1 }]);
  });

  it('defaults attention to actionable person-level statuses, including unconfirmed vehicle presence', () => {
    const overview = buildOperationalOverview(result([
      summary('late'), summary('wrong_site'), summary('evidence_mismatch'), summary('left_early'),
      summary('unassigned'), summary('unverifiable'), summary('vehicle_on_site_driver_unconfirmed'),
      summary('on_site_dual'), summary('attendance_confirmed'), summary('approaching'),
      summary('shift_complete'), summary('off_duty'),
    ]), { page: 1, limit: 25 });

    expect(overview.attention.items.map((row) => row.status)).toEqual([
      'late', 'wrong_site', 'evidence_mismatch', 'left_early', 'unassigned', 'unverifiable',
      'vehicle_on_site_driver_unconfirmed',
    ]);
    expect(overview.selectionState).toBe('attention_available');
    expect(JSON.stringify(overview)).not.toMatch(/latitude|longitude|coordinates|geometry/);
  });

  it('paginates attention after grouping and retains evaluation and rule metadata', () => {
    const overview = buildOperationalOverview(result([
      summary('late'), summary('wrong_site'), summary('on_site_dual'), summary('unassigned'),
    ]), { page: 2, limit: 1 });

    expect(overview.groups).toEqual([
      { group: 'on_site', count: 1 },
      { group: 'late', count: 1 },
      { group: 'wrong_site', count: 1 },
      { group: 'unassigned', count: 1 },
    ]);
    expect(overview.attention).toMatchObject({ total: 3, page: 2, limit: 1, hasMore: true });
    expect(overview.attention.items).toMatchObject([{ status: 'wrong_site', ruleId: 'rule-1', ruleVersion: 3, reasonCodes: ['test_reason'] }]);
  });

  it('distinguishes a successful empty roster from a successful roster with no attention', () => {
    expect(buildOperationalOverview(result([]), { page: 1, limit: 25 }).selectionState).toBe('no_scheduled_staff');
    expect(buildOperationalOverview(result([summary('on_site_dual')]), { page: 1, limit: 25 }).selectionState).toBe('no_attention');
    expect(coordinateFreeContract).toBeUndefined();
  });
});
