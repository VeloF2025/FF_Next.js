/**
 * Unit tests for serialHoldingsService — pool is mocked so we assert the
 * row→type mapping and the null-on-unknown name lookups without a DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ pool: { query: queryMock } }));

import {
  listWarehousesWithSerials,
  listProjectsWithSerials,
  getWarehouseName,
  getProjectName,
} from '@/modules/procurement/field-stock/services/serialHoldingsService';

describe('serialHoldingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps warehouse rows and parses serial_count to a number', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 'w1', name: 'Main WH', code: 'WH-1', location_type: 'warehouse', serial_count: '12' },
        { id: 'w2', name: 'Van 7', code: null, location_type: 'technician', serial_count: '3' },
      ],
    });
    const rows = await listWarehousesWithSerials();
    expect(rows).toEqual([
      { id: 'w1', name: 'Main WH', code: 'WH-1', locationType: 'warehouse', serialCount: 12 },
      { id: 'w2', name: 'Van 7', code: null, locationType: 'technician', serialCount: 3 },
    ]);
  });

  it('maps project rows and parses serial_count to a number', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'p1', project_name: 'Lawley', serial_count: '40' }],
    });
    const rows = await listProjectsWithSerials();
    expect(rows).toEqual([{ id: 'p1', projectName: 'Lawley', serialCount: 40 }]);
  });

  it('returns the warehouse name when found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ name: 'Main WH' }] });
    expect(await getWarehouseName('w1')).toBe('Main WH');
  });

  it('returns null when the warehouse id is unknown', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getWarehouseName('nope')).toBeNull();
  });

  it('returns the project name when found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ project_name: 'Lawley' }] });
    expect(await getProjectName('p1')).toBe('Lawley');
  });

  it('returns null when the project id is unknown', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getProjectName('nope')).toBeNull();
  });
});
