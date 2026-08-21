import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ deleteIncidentStorageObject: vi.fn() }));
vi.mock('../storageDeletion', () => storage);

import { deletePlannedObjects } from '../storageDeletionRunner';

beforeEach(() => {
  vi.clearAllMocks();
  storage.deleteIncidentStorageObject.mockResolvedValue('deleted');
});

describe('the destructive loop', () => {
  it('deletes every planned object and counts real deletions apart from absences', async () => {
    storage.deleteIncidentStorageObject
      .mockResolvedValueOnce('deleted')
      .mockResolvedValueOnce('already_absent')
      .mockResolvedValueOnce('deleted');
    const counts = await deletePlannedObjects(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(counts).toEqual({ deleted: 2, alreadyAbsent: 1 });
  });

  it('stops at the object that failed, leaving the rest untouched', async () => {
    storage.deleteIncidentStorageObject
      .mockResolvedValueOnce('deleted')
      .mockRejectedValueOnce(new Error('VF Storage delete failed: HTTP 500'));
    await expect(deletePlannedObjects(['a.jpg', 'b.jpg', 'c.jpg'])).rejects.toThrow(/HTTP 500/);
    expect(storage.deleteIncidentStorageObject).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty plan', async () => {
    expect(await deletePlannedObjects([])).toEqual({ deleted: 0, alreadyAbsent: 0 });
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
  });
});

/**
 * The structural half of the invariant.
 *
 * The rule "nothing between the first delete and the commit may throw for a
 * reason other than this object failing" cannot be enforced by an ordering
 * assertion alone — an ordering test passes right up until someone adds a
 * database call inside the loop. What CAN be enforced is the module's reach:
 * a call that fails for a run-level or item-level reason has to come from an
 * import, and this pins the import list to exactly one entry.
 *
 * If this test fails, do not widen the allow-list. Move the new work into the
 * planning phase (before the first delete) or the commit phase (after it).
 */
describe('containment', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/modules/fleet/incidents/retention/storageDeletionRunner.ts'), 'utf8',
  );

  it('imports nothing but the single-object storage delete', () => {
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports).toEqual(['./storageDeletion']);
  });

  it('reaches no database, repository, settings or logging module', () => {
    expect(source).not.toMatch(/db-pool|Repository|repository|settingsRepository|incidentPurge|@\/lib\/logger/);
  });

  it('awaits nothing but the storage delete', () => {
    const awaited = [...source.matchAll(/await\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]);
    expect([...new Set(awaited)]).toEqual(['deleteIncidentStorageObject']);
  });
});
