import { describe, expect, it, vi } from 'vitest';

import {
  discoverProjects,
  groupProjects,
  SOW_SITE_CODE,
} from '../lib/sync-stages-discovery.mjs';

type ProjectRow = {
  id: string;
  project_name: string;
  prefix: unknown;
  stage_tracking: unknown;
};

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'uuid-lawley',
    project_name: 'Lawley',
    prefix: 'LAW',
    stage_tracking: null,
    ...overrides,
  };
}

const THEMBISA_1 = projectRow({ id: 'uuid-pop1', project_name: 'Thembisa POP 1', prefix: 'TEM' });
const THEMBISA_3 = projectRow({ id: 'uuid-pop3', project_name: 'Thembisa POP 3', prefix: 'TEM' });
const THEMBELIHLE = projectRow({
  id: 'uuid-thembelihle',
  project_name: "Themb'elihle",
  prefix: null,
  stage_tracking: 'sow',
});

describe('sync-stages project discovery', () => {
  it('stages every project sharing one 1Map prefix', () => {
    const { byPrefix, sowOnly } = groupProjects([THEMBISA_1, projectRow(), THEMBISA_3]);

    expect(byPrefix.get('TEM')?.map(p => p.name)).toEqual(['Thembisa POP 1', 'Thembisa POP 3']);
    expect(byPrefix.get('TEM')?.map(p => p.uuid)).toEqual(['uuid-pop1', 'uuid-pop3']);
    expect(byPrefix.get('LAW')?.map(p => p.name)).toEqual(['Lawley']);
    expect(sowOnly).toEqual([]);
  });

  it('routes a project with no prefix but stage_tracking=sow to the SOW pass', () => {
    const { byPrefix, sowOnly } = groupProjects([THEMBELIHLE]);

    expect(byPrefix.size).toBe(0);
    expect(sowOnly).toEqual([
      { uuid: 'uuid-thembelihle', name: "Themb'elihle", prefix: null },
    ]);
  });

  it('syncs a project carrying both markers once, via the prefix path', () => {
    const both = projectRow({
      id: 'uuid-both',
      project_name: 'Etwatwa',
      prefix: 'ETW',
      stage_tracking: 'sow',
    });

    const { byPrefix, sowOnly } = groupProjects([both]);

    expect(byPrefix.get('ETW')?.map(p => p.uuid)).toEqual(['uuid-both']);
    expect(sowOnly).toEqual([]);
  });

  it('normalizes the stored prefix before grouping', () => {
    const { byPrefix } = groupProjects([
      projectRow({ id: 'uuid-a', prefix: ' tem ' }),
      THEMBISA_3,
    ]);

    expect([...byPrefix.keys()]).toEqual(['TEM']);
    expect(byPrefix.get('TEM')?.map(p => p.uuid)).toEqual(['uuid-a', 'uuid-pop3']);
  });

  it('drops a row with a blank prefix that is not SOW-tracked', () => {
    const { byPrefix, sowOnly } = groupProjects([
      projectRow({ id: 'uuid-blank', prefix: '   ', stage_tracking: null }),
    ]);

    expect(byPrefix.size).toBe(0);
    expect(sowOnly).toEqual([]);
  });

  it('honours the CLI prefix filter, matching case-insensitively', () => {
    const { byPrefix } = groupProjects([THEMBISA_1, projectRow(), THEMBISA_3], ['tem']);

    expect([...byPrefix.keys()]).toEqual(['TEM']);
    expect(byPrefix.get('TEM')).toHaveLength(2);
  });

  it('excludes SOW projects unless the SOW code is requested', () => {
    const rows = [THEMBISA_1, THEMBELIHLE];

    expect(groupProjects(rows, ['TEM']).sowOnly).toEqual([]);

    const sowRun = groupProjects(rows, [SOW_SITE_CODE]);
    expect(sowRun.byPrefix.size).toBe(0);
    expect(sowRun.sowOnly.map(p => p.name)).toEqual(["Themb'elihle"]);
  });

  it('selects both opt-in markers from the database and releases the client', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [THEMBISA_1, THEMBELIHLE] });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) };

    const { byPrefix, sowOnly } = await discoverProjects(pool, []);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/metadata->>'onemap_prefix' IS NOT NULL/);
    expect(sql).toMatch(/metadata->>'stage_tracking' = 'sow'/);
    expect(sql).toMatch(/status = 'active'/);
    expect(byPrefix.get('TEM')).toHaveLength(1);
    expect(sowOnly).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
