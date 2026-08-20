import { createMocks } from 'node-mocks-http';

const { poolMock } = vi.hoisted(() => ({ poolMock: { query: vi.fn() } }));
vi.mock('@/lib/db', () => ({ __esModule: true, default: poolMock }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import handler from '@/pages/api/works-qa/poles';

describe('works-qa/poles — zone_no filter', () => {
  beforeEach(() => {
    poolMock.query.mockReset();
    poolMock.query.mockResolvedValue({ rows: [] });
  });

  it('applies a zone_no filter to BOTH the photographed and planted queries', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'p1', zone_no: '13' } });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);

    const calls = poolMock.query.mock.calls;
    expect(calls.length).toBe(2); // photoQuery + plantedQuery
    for (const [sql, params] of calls) {
      expect(sql as string).toMatch(/zone_no = \$/);
      expect(params as unknown[]).toContain(13);
    }
  });

  it('combines zone_no and pon_no filters when both are provided', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'p1', zone_no: '13', pon_no: '223' } });
    // @ts-expect-error node-mocks res type
    await handler(req, res);
    for (const [sql, params] of poolMock.query.mock.calls) {
      expect(sql as string).toMatch(/zone_no = \$/);
      expect(sql as string).toMatch(/pon_no = \$/);
      expect(params as unknown[]).toEqual(expect.arrayContaining([13, 223]));
    }
  });

  it('adds no zone filter when zone_no is absent (project-wide)', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'p1' } });
    // @ts-expect-error node-mocks res type
    await handler(req, res);
    for (const [sql] of poolMock.query.mock.calls) {
      expect(sql as string).not.toMatch(/zone_no = \$/);
    }
  });

  it('400s on a non-numeric zone_no', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'p1', zone_no: 'abc' } });
    // @ts-expect-error node-mocks res type
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
