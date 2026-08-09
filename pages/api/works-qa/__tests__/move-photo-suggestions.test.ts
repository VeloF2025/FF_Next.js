const { poolMock, clientMock } = vi.hoisted(() => {
  const clientMock = { query: vi.fn(), release: vi.fn() };
  return {
    clientMock,
    poolMock: {
      query: vi.fn(),
      connect: vi.fn(async () => clientMock),
    },
  };
});

vi.mock('@/lib/db', () => ({ __esModule: true, default: poolMock }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import handler from '../move-photo';
import { createMocks } from 'node-mocks-http';

const POLE_ID = '00000000-0000-0000-0000-000000000001';

describe('move-photo — suggestion cleanup (Johan PR #1721 hotfix)', () => {
  beforeEach(() => {
    poolMock.query.mockReset();
    poolMock.connect.mockClear();
    clientMock.query.mockReset();
    clientMock.release.mockClear();
  });

  function setupClientMock(opts: { destBefore?: string | null; unassignedKeys?: string[] }) {
    // BEGIN
    clientMock.query.mockResolvedValueOnce({ rowCount: 0 });
    // Fetch row: vlm_results + unassigned_photo_keys + id
    clientMock.query.mockResolvedValueOnce({
      rows: [{
        id: POLE_ID,
        vlm_results: {},
        unassigned_photo_keys: opts.unassignedKeys ?? ['photo-X'],
      }],
    });
    // Subsequent: source clear (with suggestion -), dest select, dest set/swap, INSERT examples, COMMIT
    // We'll return generic results for the remaining; the dest SELECT needs a row.
    clientMock.query.mockImplementation(async (sql: string) => {
      if (/AS col_val FROM pole_qa_photos/.test(sql)) {
        return { rows: [{ col_val: opts.destBefore ?? null }] };
      }
      return { rowCount: 1 };
    });
  }

  it('removes photo_key from unassigned_suggestions when moving FROM unassigned', async () => {
    setupClientMock({ destBefore: null, unassignedKeys: ['photo-X'] });

    const { req, res } = createMocks({
      method: 'POST',
      body: { pole_id: POLE_ID, photo_key: 'photo-X', from: 'unassigned', to: 'civil_03' },
    });
    (req as unknown as { user: { email: string } }).user = { email: 'test@example.com' };
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    // Find the source-clear UPDATE (unassigned branch — should also strip suggestion)
    const sourceClearCall = clientMock.query.mock.calls.find(c =>
      /SET unassigned_photo_keys = array_remove/.test(String(c[0]))
    );
    expect(sourceClearCall).toBeDefined();
    expect(String(sourceClearCall![0])).toMatch(/unassigned_suggestions = unassigned_suggestions - \$1::text/);
  });

  it('also strips suggestion for displaced photo when slot swap occurs', async () => {
    // Slot dome_03 already has a different photo Y; suggestion Y → dome_03 might be stale.
    setupClientMock({ destBefore: 'photo-Y', unassignedKeys: ['photo-X'] });

    const { req, res } = createMocks({
      method: 'POST',
      body: { pole_id: POLE_ID, photo_key: 'photo-X', from: 'unassigned', to: 'dome_03' },
    });
    (req as unknown as { user: { email: string } }).user = { email: 'test@example.com' };
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    // Displaced push UPDATE should also strip suggestion for the displaced photo
    const displacedPushCall = clientMock.query.mock.calls.find(c =>
      /SET unassigned_photo_keys = array_append/.test(String(c[0]))
      && /unassigned_suggestions = unassigned_suggestions - \$1::text/.test(String(c[0]))
    );
    expect(displacedPushCall).toBeDefined();
    // The bound parameter should be the DISPLACED photo (photo-Y), not the moving one
    expect(displacedPushCall![1]).toEqual(expect.arrayContaining(['photo-Y']));
  });

  it('no displaced push when slot already holds the same photo (data anomaly cleanup)', async () => {
    // H229 case: photo-X is both in unassigned AND in dome_02 slot.
    setupClientMock({ destBefore: 'photo-X', unassignedKeys: ['photo-X'] });

    const { req, res } = createMocks({
      method: 'POST',
      body: { pole_id: POLE_ID, photo_key: 'photo-X', from: 'unassigned', to: 'dome_02' },
    });
    (req as unknown as { user: { email: string } }).user = { email: 'test@example.com' };
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    // Source clear removed X from unassigned + stripped its suggestion
    const sourceClear = clientMock.query.mock.calls.find(c =>
      /SET unassigned_photo_keys = array_remove/.test(String(c[0]))
    );
    expect(sourceClear).toBeDefined();
    // NO displaced push should fire (displaced === photo_key)
    const displacedPush = clientMock.query.mock.calls.find(c =>
      /SET unassigned_photo_keys = array_append/.test(String(c[0]))
    );
    expect(displacedPush).toBeUndefined();
  });

  it('strips suggestion when moving FROM slot TO unassigned (drag-out)', async () => {
    // Drag dome_03's photo back to unassigned bucket.
    // Need different setup because source is a slot, dest is unassigned.
    clientMock.query.mockReset();
    clientMock.query.mockResolvedValueOnce({ rowCount: 0 }); // BEGIN
    clientMock.query.mockResolvedValueOnce({
      rows: [{ id: POLE_ID, vlm_results: { dome_03: { confidence: 0.5 } }, unassigned_photo_keys: [] }],
    });
    // The from-slot existence check
    clientMock.query.mockImplementation(async (sql: string) => {
      if (/AS col_val FROM pole_qa_photos/.test(sql)) {
        return { rows: [{ col_val: 'photo-Z' }] };
      }
      return { rowCount: 1 };
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { pole_id: POLE_ID, photo_key: 'photo-Z', from: 'dome_03', to: 'unassigned' },
    });
    (req as unknown as { user: { email: string } }).user = { email: 'test@example.com' };
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    // The push-to-unassigned UPDATE should ALSO strip any stale suggestion for photo-Z
    const pushToUnassigned = clientMock.query.mock.calls.find(c =>
      /SET unassigned_photo_keys = array_append/.test(String(c[0]))
      && /unassigned_suggestions = unassigned_suggestions - \$1::text/.test(String(c[0]))
    );
    expect(pushToUnassigned).toBeDefined();
    expect(pushToUnassigned![1]).toEqual(expect.arrayContaining(['photo-Z']));
  });
});
