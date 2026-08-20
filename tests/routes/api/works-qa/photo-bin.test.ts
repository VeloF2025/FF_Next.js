import { createMocks } from 'node-mocks-http';

// photo-bin uses pool.connect() → client.query/release (transaction), so mock a client.
const { clientMock, poolMock } = vi.hoisted(() => {
  const clientMock = { query: vi.fn(), release: vi.fn() };
  return { clientMock, poolMock: { connect: vi.fn(async () => clientMock) } };
});

vi.mock('@/lib/db', () => ({ __esModule: true, default: poolMock }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import handler from '@/pages/api/works-qa/photo-bin';

/** Return the SQL text of the UPDATE call (there is exactly one per success). */
function updateSql(): string {
  const call = clientMock.query.mock.calls.find(c => /UPDATE pole_qa_photos/i.test(c[0] as string));
  return (call?.[0] as string) ?? '';
}

function allSql(): string {
  return clientMock.query.mock.calls.map(c => c[0] as string).join('\n');
}

describe('photo-bin — soft delete + restore', () => {
  beforeEach(() => {
    clientMock.query.mockReset();
    clientMock.release.mockReset();
  });

  function mockSelect(rows: { unassigned_photo_keys: string[]; deleted_photo_keys: string[] }[]) {
    clientMock.query.mockImplementation((sql: string) => {
      if (/SELECT/i.test(sql)) return Promise.resolve({ rows });
      return Promise.resolve({});
    });
  }

  it('delete moves the key unassigned → deleted', async () => {
    mockSelect([{ unassigned_photo_keys: ['k1', 'k2'], deleted_photo_keys: [] }]);
    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1', photo_key: 'k1', action: 'delete' } });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const sql = updateSql();
    expect(sql).toMatch(/unassigned_photo_keys = array_remove/);
    expect(sql).toMatch(/deleted_photo_keys\s*=\s*array_append/);
  });

  it('restore moves the key deleted → unassigned', async () => {
    mockSelect([{ unassigned_photo_keys: [], deleted_photo_keys: ['k1'] }]);
    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1', photo_key: 'k1', action: 'restore' } });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const sql = updateSql();
    expect(sql).toMatch(/deleted_photo_keys\s*=\s*array_remove/);
    expect(sql).toMatch(/unassigned_photo_keys\s*=\s*array_append/);
  });

  it('never writes a qa_correction_examples row (binning is not a VLM correction)', async () => {
    mockSelect([{ unassigned_photo_keys: ['k1'], deleted_photo_keys: [] }]);
    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1', photo_key: 'k1', action: 'delete' } });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(allSql()).not.toMatch(/qa_correction_examples/i);
  });

  it('rejects a key not present in the source bucket', async () => {
    mockSelect([{ unassigned_photo_keys: ['other'], deleted_photo_keys: [] }]);
    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1', photo_key: 'k1', action: 'delete' } });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
    // No UPDATE should have run.
    expect(updateSql()).toBe('');
  });

  it('rejects an unknown action', async () => {
    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1', photo_key: 'k1', action: 'purge' } });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
