import { describe, it, expect } from 'vitest';
import { rollupRecent, isNewSinceWatermark, type RecentFeedRow } from '../utils/recent-rollup';

function row(over: Partial<RecentFeedRow>): RecentFeedRow {
  return {
    project_id: 'p1',
    project_name: 'Mohadin',
    zone_no: 2,
    pon_no: 25,
    discipline: 'civil',
    ready_count: 0,
    partial_count: 0,
    latest_ready_at: null,
    latest_partial_at: null,
    ...over,
  };
}

describe('rollupRecent', () => {
  it('returns three empty lanes for no rows', () => {
    const lanes = rollupRecent([]);
    expect(lanes.civil).toEqual({ readyPoles: 0, partialPoles: 0, sites: [] });
    expect(lanes.dome.sites).toHaveLength(0);
    expect(lanes.main_joint.readyPoles).toBe(0);
  });

  it('sums ready/partial per lane and nests Site → Zone → PON', () => {
    const lanes = rollupRecent([
      row({ discipline: 'civil', pon_no: 25, ready_count: 6, partial_count: 1, latest_ready_at: '2026-06-07T00:00:00Z' }),
      row({ discipline: 'civil', pon_no: 26, ready_count: 2, partial_count: 0, latest_ready_at: '2026-06-06T00:00:00Z' }),
    ]);
    expect(lanes.civil.readyPoles).toBe(8);
    expect(lanes.civil.partialPoles).toBe(1);
    expect(lanes.civil.sites).toHaveLength(1);
    const site = lanes.civil.sites[0]!;
    expect(site.projectName).toBe('Mohadin');
    expect(site.zones).toHaveLength(1);
    expect(site.zones[0]!.pons.map(p => p.ponNo)).toEqual([25, 26]);
    expect(site.zones[0]!.pons[0]!.latestAt).toBe('2026-06-07T00:00:00Z');
  });

  it('keeps disciplines and projects in separate buckets', () => {
    const lanes = rollupRecent([
      row({ discipline: 'civil', project_id: 'p1', project_name: 'Mohadin', ready_count: 1 }),
      row({ discipline: 'dome', project_id: 'p1', project_name: 'Mohadin', partial_count: 5 }),
      row({ discipline: 'civil', project_id: 'p2', project_name: 'Lawley', zone_no: 1, ready_count: 3 }),
    ]);
    expect(lanes.civil.sites.map(s => s.projectName).sort()).toEqual(['Lawley', 'Mohadin']);
    expect(lanes.dome.sites).toHaveLength(1);
    expect(lanes.dome.partialPoles).toBe(5);
  });

  it('groups null zone (un-zoned poles) under its own bucket', () => {
    const lanes = rollupRecent([
      row({ zone_no: null, pon_no: 99, ready_count: 1 }),
      row({ zone_no: 2, pon_no: 25, ready_count: 1 }),
    ]);
    const zones = lanes.civil.sites[0]!.zones;
    expect(zones).toHaveLength(2);
    expect(zones.some(z => z.zoneNo === null)).toBe(true);
  });

  it('falls back to latest_partial_at when no ready timestamp', () => {
    const lanes = rollupRecent([
      row({ ready_count: 0, partial_count: 3, latest_ready_at: null, latest_partial_at: '2026-06-05T12:00:00Z' }),
    ]);
    expect(lanes.civil.sites[0]!.zones[0]!.pons[0]!.latestAt).toBe('2026-06-05T12:00:00Z');
  });
});

describe('isNewSinceWatermark', () => {
  it('is true when latest is after the watermark', () => {
    expect(isNewSinceWatermark('2026-06-07T00:00:00Z', '2026-06-05T00:00:00Z')).toBe(true);
  });
  it('is false when latest is at or before the watermark', () => {
    expect(isNewSinceWatermark('2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z')).toBe(false);
    expect(isNewSinceWatermark('2026-06-04T00:00:00Z', '2026-06-05T00:00:00Z')).toBe(false);
  });
  it('is false when either timestamp is missing', () => {
    expect(isNewSinceWatermark(null, '2026-06-05T00:00:00Z')).toBe(false);
    expect(isNewSinceWatermark('2026-06-07T00:00:00Z', null)).toBe(false);
  });
});
