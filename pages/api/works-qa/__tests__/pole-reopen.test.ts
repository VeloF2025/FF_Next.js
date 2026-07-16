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

import handler from '../pole-reopen';

function post(body: Record<string, unknown>) {
  const { req, res } = createMocks({ method: 'POST', body });
  (req as unknown as { user: { email: string } }).user = { email: 'reviewer@velocityfibre.co.za' };
  return { req, res };
}

describe('pole-reopen', () => {
  beforeEach(() => poolMock.query.mockReset());

  it('flips the discipline flag FALSE and clears approved_at', async () => {
    poolMock.query.mockResolvedValueOnce({
      rows: [{ civil_approved: false, dome_approved: true, joint_approved: true, approved_at: null }],
    });
    const { req, res } = post({ pole_id: 'pole-1', discipline: 'civil' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const sql = poolMock.query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/civil_approved = FALSE/);
    expect(sql).toMatch(/approved_at = NULL/);
  });

  it('maps main_joint discipline to the legacy joint_approved column', async () => {
    poolMock.query.mockResolvedValueOnce({
      rows: [{ civil_approved: true, dome_approved: true, joint_approved: false, approved_at: null }],
    });
    const { req, res } = post({ pole_id: 'pole-1', discipline: 'main_joint' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(poolMock.query.mock.calls[0]![0] as string).toMatch(/joint_approved = FALSE/);
  });

  it('returns 404 when the pole does not exist', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = post({ pole_id: 'missing', discipline: 'civil' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('rejects an unknown discipline', async () => {
    const { req, res } = post({ pole_id: 'pole-1', discipline: 'electrical' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it('rejects a missing pole_id', async () => {
    const { req, res } = post({ discipline: 'civil' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
