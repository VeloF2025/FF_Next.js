import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';

vi.mock('@/modules/vlm-training/services/trainingDataService', () => ({
  listTrainingDrops: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withRole: () => (handler: unknown) => handler,
}));

import { listTrainingDrops } from '@/modules/vlm-training/services/trainingDataService';
import handler from '../list';

const mockList = vi.mocked(listTrainingDrops);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/vlm-training/list', () => {
  it('rejects non-GET methods', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns paginated results with regions', async () => {
    mockList.mockResolvedValue({
      rows: [{ id: 'abc', drop_number: 'DR-001', region: 'Alexandra' }] as never,
      total: 1,
      regions: ['Alexandra', 'KwaNobuhle'],
    });

    const { req, res } = createMocks({ method: 'GET', query: { page: '1', pageSize: '10' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    // apiResponse.paginated puts rows in body.data and regions in body.meta.regions
    expect(body.data).toHaveLength(1);
    expect(body.meta.regions).toContain('Alexandra');
    expect(body.pagination.total).toBe(1);
    expect(body.pagination.totalPages).toBe(1);
  });

  it('returns 400 for non-integer page', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { page: 'abc' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 for non-integer pageSize', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { pageSize: 'xyz' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 for page < 1', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { page: '0' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('passes region filter to service', async () => {
    mockList.mockResolvedValue({ rows: [], total: 0, regions: [] });

    const { req, res } = createMocks({ method: 'GET', query: { region: 'KwaMashu' } });
    await handler(req, res);

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'KwaMashu' })
    );
  });

  it('passes activeOnly=true when query param is "true"', async () => {
    mockList.mockResolvedValue({ rows: [], total: 0, regions: [] });

    const { req, res } = createMocks({ method: 'GET', query: { activeOnly: 'true' } });
    await handler(req, res);

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ activeOnly: true })
    );
  });

  it('returns 500 on service error', async () => {
    mockList.mockRejectedValue(new Error('DB connection failed'));

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
  });
});
