import fs from 'fs';

const { poolMock } = vi.hoisted(() => ({ poolMock: { query: vi.fn() } }));

vi.mock('@/lib/db', () => ({ __esModule: true, default: poolMock }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/vfStorageAdapter', () => ({
  vfStorage: {
    uploadFile: vi.fn(async () => ({ path: 'works-qa/proj-1/PA001/unassigned/x.jpg' })),
  },
}));
vi.mock('@/modules/works-qa/services/worksQaVlmService', () => ({
  validatePhotoWithVlm: vi.fn(async () => ({
    valid: true, confidence: 0.9, feedback: 'ok',
  })),
  isVlmFallback: vi.fn(() => false),
  FALLBACK_RESULT: { valid: false, confidence: 0, feedback: 'VLM validation failed — manual review required' },
}));

// Replace formidable to feed canned fields/files
vi.mock('formidable', () => {
  return {
    default: vi.fn(() => ({
      parse: (_req: unknown, cb: (err: unknown, fields: unknown, files: unknown) => void) => {
        const tmp = '/tmp/_test-upload-unassigned.jpg';
        fs.writeFileSync(tmp, Buffer.from('fakeimg'));
        cb(null,
          { pole_id: 'pole-1', slot: 'unassigned' },
          { photo: { filepath: tmp } });
      },
    })),
  };
});

import handler from '../pole-assign';
import { createMocks } from 'node-mocks-http';

describe('pole-assign — slot=unassigned', () => {
  beforeEach(() => {
    poolMock.query.mockReset();
    // pole-fetch query
    poolMock.query.mockResolvedValueOnce({
      rows: [{ project_id: 'proj-1', pole_label: 'PA001' }],
    });
    // UPDATE query
    poolMock.query.mockResolvedValueOnce({ rowCount: 1 });
  });

  it('appends to unassigned_photo_keys (not main_joint_tray_keys)', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    // The 2nd query should be an UPDATE on unassigned_photo_keys
    const updateSql = poolMock.query.mock.calls[1]![0] as string;
    expect(updateSql).toMatch(/unassigned_photo_keys = array_append/);
    expect(updateSql).not.toMatch(/main_joint_tray_keys = array_append/);

    expect(res._getStatusCode()).toBe(200);
  });
});
