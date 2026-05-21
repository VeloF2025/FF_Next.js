import JSZip from 'jszip';

// Note: pon-zip.ts is currently not unit-tested. Project precedent
// (see pages/api/works-qa/__tests__/photo-snag-api.test.ts) mocks the
// pool import via vi.mock. Follow that pattern.

const { poolMock } = vi.hoisted(() => ({ poolMock: { query: vi.fn() } }));

vi.mock('@/lib/db', () => ({ __esModule: true, default: poolMock }));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub fetch for photo retrieval — return a tiny PNG buffer.
const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => tinyPng,
  status: 200,
})));

import handler from '../pon-zip';
import { createMocks } from 'node-mocks-http';

const FIXTURE_POLE = {
  id: 'pole-1',
  project_id: 'proj-1',
  pole_label: 'TEST.P.A001',
  pon_no: 999,
  approved_at: '2026-05-21T00:00:00Z',
  civil_step_01_key: null,
  civil_step_02_key: null,
  civil_step_03_key: null,
  civil_step_04_key: null,
  civil_step_05_key: null,
  civil_step_06_key: null,
  civil_step_07_key: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg',
  optical_dome_01_key: null,
  optical_dome_02_key: null,
  optical_dome_03_key: null,
  optical_dome_04_key: null,
  optical_dome_05_key: null,
  optical_dome_06_key: null,
  optical_dome_07_key: null,
  optical_dome_08_key: null,
  main_joint_11_key: null,
  main_joint_12_key: null,
  main_joint_13_key: null,
  main_joint_14_key: null,
  main_joint_15_key: null,
  main_joint_16_key: null,
  main_joint_tray_keys: [],
  unassigned_photo_keys: [
    'works-qa/proj-1/TEST.P.A001/unassigned/u1.jpg',
    'works-qa/proj-1/TEST.P.A001/unassigned/u2.jpg',
  ],
};

describe('pon-zip — unassigned bucket', () => {
  beforeEach(() => {
    poolMock.query.mockReset();
    poolMock.query.mockResolvedValue({ rows: [FIXTURE_POLE] });
  });

  it('includes unassigned/ folder when include_unapproved=true', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', pon_no: '999', include_unapproved: 'true' },
    });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);

    const buf = res._getBuffer();
    const zip = await JSZip.loadAsync(buf);
    const paths = Object.keys(zip.files);

    expect(paths).toEqual(expect.arrayContaining([
      'PON_999/TEST.P.A001/unassigned/photo_01.jpg',
      'PON_999/TEST.P.A001/unassigned/photo_02.jpg',
    ]));
  });

  it('still excludes in-progress poles by default (backward compat)', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [] }); // approved_at filter returns nothing
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', pon_no: '999' },
    });
    // @ts-expect-error
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);

    // Inspect the SQL query for the approved_at clause
    const sql = poolMock.query.mock.calls[0]![0] as string;
    expect(sql).toMatch(/approved_at IS NOT NULL/);
  });

  it('include_unapproved=true drops the approved_at filter from the SQL', async () => {
    const IN_PROGRESS_POLE = { ...FIXTURE_POLE, approved_at: null };
    poolMock.query.mockResolvedValueOnce({ rows: [IN_PROGRESS_POLE] });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', pon_no: '999', include_unapproved: 'true' },
    });
    // @ts-expect-error
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const sql = poolMock.query.mock.calls[0]![0] as string;
    expect(sql).not.toMatch(/approved_at IS NOT NULL/);
  });

  it('omits the unassigned/ folder when a pole has no unassigned keys (default-ZIP byte stability)', async () => {
    const CLEAN_POLE = { ...FIXTURE_POLE, unassigned_photo_keys: [] };
    poolMock.query.mockResolvedValueOnce({ rows: [CLEAN_POLE] });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', pon_no: '999' },
    });
    // @ts-expect-error
    await handler(req, res);

    const buf = res._getBuffer();
    const zip = await JSZip.loadAsync(buf);
    const paths = Object.keys(zip.files);

    expect(paths.some(p => p.includes('/unassigned/'))).toBe(false);
    expect(paths.some(p => p.includes('/unassigned'))).toBe(false);
  });
});
