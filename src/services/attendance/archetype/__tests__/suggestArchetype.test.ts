import { describe, it, expect } from 'vitest';
import { suggestArchetype } from '../suggestArchetype';

describe('suggestArchetype', () => {
  it('returns project when >=80% of clock-ins fall in a single project polygon', () => {
    const result = suggestArchetype({
      totalClockIns: 20,
      pctInsideAnyAssignedPolygon: 95,
      pctInsideOffice: 0,
      pctUnmatched: 5,
      maxSingleProjectPct: 90,
      distinctProjectPolygonsHit: 1,
      perProjectPct: { 'p-uuid': 90 },
    });
    expect(result).toEqual({ archetype: 'project', lowSignal: false });
  });

  it('returns mobile when >=3 polygons each have >10% of clock-ins', () => {
    const result = suggestArchetype({
      totalClockIns: 30,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 40,
      distinctProjectPolygonsHit: 3,
      perProjectPct: { a: 40, b: 30, c: 30 },
    });
    expect(result).toEqual({ archetype: 'mobile', lowSignal: false });
  });

  it('returns office when >=80% of clock-ins are within an office geofence', () => {
    const result = suggestArchetype({
      totalClockIns: 22,
      pctInsideAnyAssignedPolygon: 5,
      pctInsideOffice: 95,
      pctUnmatched: 0,
      maxSingleProjectPct: 5,
      distinctProjectPolygonsHit: 0,
      perProjectPct: {},
    });
    expect(result).toEqual({ archetype: 'office', lowSignal: false });
  });

  it('returns office with lowSignal when fewer than 5 clock-ins', () => {
    const result = suggestArchetype({
      totalClockIns: 3,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 100,
      distinctProjectPolygonsHit: 1,
      perProjectPct: { a: 100 },
    });
    expect(result).toEqual({ archetype: 'office', lowSignal: true });
  });

  it('returns office with lowSignal when no rule threshold is met', () => {
    const result = suggestArchetype({
      totalClockIns: 20,
      pctInsideAnyAssignedPolygon: 50,
      pctInsideOffice: 30,
      pctUnmatched: 20,
      maxSingleProjectPct: 50,
      distinctProjectPolygonsHit: 2,
      perProjectPct: { a: 30, b: 20 },
    });
    expect(result).toEqual({ archetype: 'office', lowSignal: true });
  });

  it('first-match-wins: project rule beats mobile when both could match', () => {
    const result = suggestArchetype({
      totalClockIns: 40,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 85,
      distinctProjectPolygonsHit: 4,
      perProjectPct: { a: 85, b: 5, c: 5, d: 5 },
    });
    expect(result).toEqual({ archetype: 'project', lowSignal: false });
  });

  it('first-match-wins: mobile rule beats office when both could match', () => {
    const result = suggestArchetype({
      totalClockIns: 25,
      pctInsideAnyAssignedPolygon: 100,
      pctInsideOffice: 0,
      pctUnmatched: 0,
      maxSingleProjectPct: 40,
      distinctProjectPolygonsHit: 3,
      perProjectPct: { a: 40, b: 30, c: 30 },
    });
    expect(result).toEqual({ archetype: 'mobile', lowSignal: false });
  });
});
