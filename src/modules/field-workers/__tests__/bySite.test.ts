import { describe, it, expect } from 'vitest';
import { attributedSite, groupBySite } from '../bySite';
import type { FieldAttendanceRow } from '../api';

function row(over: Partial<FieldAttendanceRow>): FieldAttendanceRow {
  return {
    entry_id: 'e1', staff_id: 's1', staff_name: 'Worker', role: 'technician',
    account_status: 'active', work_date: '2026-08-19',
    clock_in_at: '2026-08-19T05:00:00Z', clock_out_at: null,
    entry_status: 'open', hours: null, entry_updated_at: '2026-08-19T05:00:00Z',
    site_geofence_id: null,
    clock_in_aoi_project: null, clock_in_aoi_distance_m: null,
    clock_out_aoi_project: null, clock_out_aoi_distance_m: null,
    ...over,
  };
}

describe('attributedSite', () => {
  it('attributes a shift to the site the clock-in landed inside', () => {
    expect(attributedSite(row({ clock_in_aoi_project: 'Lawley', clock_in_aoi_distance_m: 0 })))
      .toBe('Lawley');
  });

  it('does NOT attribute a merely-nearest site', () => {
    // 12 km from Lawley is not "working at Lawley". This is the guard against
    // the view inventing a workplace for everyone in the office.
    expect(attributedSite(row({ clock_in_aoi_project: 'Lawley', clock_in_aoi_distance_m: 12_000 })))
      .toBeNull();
  });

  it('falls back to the clock-out site for someone who travelled to site', () => {
    // The VF072 pattern: off site at clock-in, on site at clock-out. They did
    // work at Mamelodi that day and must not land in the unattributed bucket.
    expect(attributedSite(row({
      clock_in_aoi_project: 'Lawley', clock_in_aoi_distance_m: 30_000,
      clock_out_aoi_project: 'Mamelodi', clock_out_aoi_distance_m: 0,
    }))).toBe('Mamelodi');
  });

  it('prefers clock-in when both ends are on site but disagree', () => {
    expect(attributedSite(row({
      clock_in_aoi_project: 'Lawley', clock_in_aoi_distance_m: 0,
      clock_out_aoi_project: 'Mamelodi', clock_out_aoi_distance_m: 0,
    }))).toBe('Lawley');
  });
});

describe('groupBySite', () => {
  const onSite = (staff: string, site: string, entry: string) =>
    row({ staff_id: staff, entry_id: entry, staff_name: staff, clock_in_aoi_project: site, clock_in_aoi_distance_m: 0 });

  it('counts distinct workers, not rows', () => {
    // One person with three shifts in the range is one worker on that site.
    const groups = groupBySite([
      onSite('s1', 'Lawley', 'e1'),
      onSite('s1', 'Lawley', 'e2'),
      onSite('s2', 'Lawley', 'e3'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].workerCount).toBe(2);
    expect(groups[0].rows).toHaveLength(3);
  });

  it('orders sites by headcount and puts the unattributed bucket last', () => {
    const groups = groupBySite([
      row({ staff_id: 'x', entry_id: 'ex', clock_in_aoi_project: 'Lawley', clock_in_aoi_distance_m: 40_000 }),
      onSite('s1', 'Mamelodi', 'e1'),
      onSite('s2', 'Lawley', 'e2'),
      onSite('s3', 'Lawley', 'e3'),
    ]);
    expect(groups.map((g) => g.siteName)).toEqual(['Lawley', 'Mamelodi', null]);
    // Pins WHY null is last: it is the sort rule, not an accident of the
    // insertion order above (the unattributed row was inserted first).
    expect(groups[groups.length - 1].workerCount).toBe(1);
  });

  it('returns no groups for no rows', () => {
    expect(groupBySite([])).toEqual([]);
  });
});
