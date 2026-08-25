/**
 * Project attribution for a detected event.
 *
 * `project_id` scopes the manager queue, so the two failure directions are not
 * symmetric: a missing attribution shows the incident to everyone with fleet
 * scope, an invented one shows it to the wrong project and hides it from the
 * right one. Null is therefore the answer whenever the geography does not say
 * otherwise — including for a parking hit, which carries a vehicle and no
 * project at all.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveVehicleProjectId } from '../vehicleProjectResolver';

const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('resolveVehicleProjectId', () => {
  it('returns the project when the event happened inside a project AOI', async () => {
    const resolve = vi.fn(async () => ({
      id: PROJECT_ID, kind: 'project_aoi' as const, label: 'Project One', distanceM: 0,
    }));

    expect(await resolveVehicleProjectId(-26.1, 28.05, resolve)).toBe(PROJECT_ID);
  });

  it('returns null for a parking location, which has no project', async () => {
    const resolve = vi.fn(async () => ({
      id: 'parking-1', kind: 'parking' as const, label: 'Depot', distanceM: 20,
    }));

    expect(await resolveVehicleProjectId(-26.1, 28.05, resolve)).toBeNull();
  });

  it('returns null when nothing is near', async () => {
    expect(await resolveVehicleProjectId(-26.1, 28.05, async () => null)).toBeNull();
  });

  it('returns null without a coordinate, and does not query', async () => {
    const resolve = vi.fn(async () => null);

    expect(await resolveVehicleProjectId(null, 28.05, resolve)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('swallows a lookup failure — attribution must not stop the incident opening', async () => {
    const resolve = vi.fn(async () => { throw new Error('PostGIS unavailable'); });

    expect(await resolveVehicleProjectId(-26.1, 28.05, resolve)).toBeNull();
  });
});
