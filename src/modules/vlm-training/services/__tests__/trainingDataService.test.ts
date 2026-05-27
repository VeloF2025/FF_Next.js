import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db-pool';
import {
  listTrainingDrops,
  getTrainingDrop,
  excludeTrainingDrop,
} from '../trainingDataService';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listTrainingDrops', () => {
  it('clamps page to minimum 1', async () => {
    mockQueryOne.mockResolvedValue({ total: '0' });
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listTrainingDrops({ page: -5, pageSize: 10 });

    // page -5 → clamped to 1 → offset = (1-1)*10 = 0
    const dataCall = mockQuery.mock.calls[0]!;
    const params = dataCall[1] as unknown[];
    expect(params[params.length - 1]).toBe(0); // OFFSET = 0 (page 1)
    expect(params[params.length - 2]).toBe(10); // LIMIT = pageSize=10
  });

  it('clamps pageSize to maximum 100', async () => {
    mockQueryOne.mockResolvedValue({ total: '5' });
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listTrainingDrops({ page: 1, pageSize: 999 });

    // pageSize 999 → clamped to 100 (max); offset = (1-1)*100 = 0
    const dataCall = mockQuery.mock.calls[0]!;
    const params = dataCall[1] as unknown[];
    expect(params[params.length - 2]).toBe(100); // LIMIT = 100, not 999
    expect(params[params.length - 2]).not.toBe(999);
  });

  it('applies region filter when provided', async () => {
    mockQueryOne.mockResolvedValue({ total: '3' });
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listTrainingDrops({ region: 'KwaNobuhle' });

    const countCall = mockQueryOne.mock.calls[0]!;
    expect(countCall[0]).toContain('region =');
    expect(countCall[1]).toContain('KwaNobuhle');
  });

  it('skips region filter when region is "all"', async () => {
    mockQueryOne.mockResolvedValue({ total: '100' });
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listTrainingDrops({ region: 'all' });

    const countCall = mockQueryOne.mock.calls[0]!;
    expect(countCall[0]).not.toContain('region =');
  });

  it('applies activeOnly filter', async () => {
    mockQueryOne.mockResolvedValue({ total: '10' });
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await listTrainingDrops({ activeOnly: true });

    const countCall = mockQueryOne.mock.calls[0]!;
    expect(countCall[0]).toContain('excluded_from_training = false');
  });

  it('returns parsed total and region list', async () => {
    mockQueryOne.mockResolvedValue({ total: '42' });
    mockQuery
      .mockResolvedValueOnce([{ id: 'abc', drop_number: 'DR001' }])
      .mockResolvedValueOnce([{ region: 'KwaNobuhle' }, { region: 'Alexandra' }]);

    const result = await listTrainingDrops({});

    expect(result.total).toBe(42);
    expect(result.regions).toEqual(['KwaNobuhle', 'Alexandra']);
    expect(result.rows).toHaveLength(1);
  });
});

describe('getTrainingDrop', () => {
  it('returns null when drop does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await getTrainingDrop('DR-NONEXISTENT');

    expect(result).toBeNull();
  });

  it('returns drop when found', async () => {
    const drop = { id: 'uuid-1', drop_number: 'DR-001', region: 'Alexandra' };
    mockQueryOne.mockResolvedValue(drop);

    const result = await getTrainingDrop('DR-001');

    expect(result).toEqual(drop);
    expect(mockQueryOne.mock.calls[0]![1]).toEqual(['DR-001']);
  });
});

describe('excludeTrainingDrop', () => {
  it('returns true when row was updated (not already excluded)', async () => {
    mockQuery.mockResolvedValue([{ drop_number: 'DR-001' }]);

    const result = await excludeTrainingDrop('DR-001', 'Bad photo quality', 'admin@vf.co.za');

    expect(result).toBe(true);
  });

  it('returns false when drop was already excluded or not found', async () => {
    mockQuery.mockResolvedValue([]);

    const result = await excludeTrainingDrop('DR-MISSING', 'Bad photo quality', 'admin@vf.co.za');

    expect(result).toBe(false);
  });

  it('uses RETURNING clause (not rowCount)', async () => {
    mockQuery.mockResolvedValue([{ drop_number: 'DR-001' }]);

    await excludeTrainingDrop('DR-001', 'reason', 'user');

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql.toLowerCase()).toContain('returning');
  });

  it('passes reason and excludedBy as parameters', async () => {
    mockQuery.mockResolvedValue([]);

    await excludeTrainingDrop('DR-002', 'poor quality', 'reviewer@vf.co.za');

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe('poor quality');
    expect(params[1]).toBe('reviewer@vf.co.za');
    expect(params[2]).toBe('DR-002');
  });
});
