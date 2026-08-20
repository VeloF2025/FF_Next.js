import JSZip from 'jszip';
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

const tinyPng = Buffer.from('89504e470d0a1a0a', 'hex');
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => tinyPng }));
vi.stubGlobal('fetch', fetchMock);

import handler from '@/pages/api/works-qa/zone-zip';

const POLE = {
  id: 'p1', project_id: 'proj-1', pole_label: 'TEST.P.A001', zone_no: 5, pon_no: 999,
  civil_step_07_key: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg',
  main_joint_tray_keys: [],
  unassigned_photo_keys: ['works-qa/proj-1/TEST.P.A001/unassigned/u1.jpg'],
} as unknown;

async function zipPaths(res: { _getBuffer(): Buffer }): Promise<string[]> {
  const zip = await JSZip.loadAsync(res._getBuffer());
  return Object.keys(zip.files);
}

describe('zone-zip', () => {
  beforeEach(() => { poolMock.query.mockReset(); fetchMock.mockClear(); });

  it('streams a Zone_/PON_/pole tree', async () => {
    poolMock.query.mockResolvedValue({ rows: [POLE] });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' },
    });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    const paths = await zipPaths(res);
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/civil/07_after_photo.jpg');
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/unassigned/photo_01.jpg');
  });

  it('skips a missing photo and writes _manifest.txt instead of aborting', async () => {
    poolMock.query.mockResolvedValue({ rows: [POLE] });
    // first photo 404s, the rest succeed
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => tinyPng });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' },
    });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    const paths = await zipPaths(res);
    expect(paths).toContain('_manifest.txt');
  });

  it('drops the approved_at filter when include_unapproved=true', async () => {
    poolMock.query.mockResolvedValue({ rows: [POLE] });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' },
    });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    expect(poolMock.query.mock.calls[0]![0] as string).not.toMatch(/approved_at IS NOT NULL/);
  });

  it('keeps the approved_at filter by default and 404s an empty zone', async () => {
    poolMock.query.mockResolvedValue({ rows: [] });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', zone_no: '5' },
    });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
    expect(poolMock.query.mock.calls[0]![0] as string).toMatch(/approved_at IS NOT NULL/);
  });

  it('400s when zone_no is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1' } });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('400s when zone_no is not a clean number', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1', zone_no: '5abc' } });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('never fetches or archives a storage key containing ".." (Zip Slip guard)', async () => {
    const EVIL = {
      ...(POLE as Record<string, unknown>),
      civil_step_07_key: 'works-qa/proj-1/../secret.jpg',
    } as unknown;
    poolMock.query.mockResolvedValue({ rows: [EVIL] });
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' },
    });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    // the traversal key is skipped (not fetched) → no civil entry, and it is listed in the manifest
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('..');
    }
    const paths = await zipPaths(res);
    expect(paths.some(p => p.includes('/civil/'))).toBe(false);
    expect(paths).toContain('_manifest.txt');
  });
});
