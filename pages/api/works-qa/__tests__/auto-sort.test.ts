const { poolMock, clientMock } = vi.hoisted(() => {
  const clientMock = {
    query: vi.fn(),
    release: vi.fn(),
  };
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
vi.mock('@/modules/works-qa/services/worksQaVlmService', () => ({
  classifyPhotoToSlot: vi.fn(),
}));

import { classifyPhotoToSlot } from '@/modules/works-qa/services/worksQaVlmService';
import handler from '../auto-sort';
import { createMocks } from 'node-mocks-http';

const mockedClassify = classifyPhotoToSlot as ReturnType<typeof vi.fn>;

function makePoleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pole-1',
    project_id: 'proj-1',
    pole_label: 'TEST.P.A001',
    unassigned_photo_keys: ['works-qa/proj-1/TEST/u1.jpg'],
    civil_step_01_key: null,
    civil_step_02_key: null,
    civil_step_03_key: null,
    civil_step_04_key: null,
    civil_step_05_key: null,
    civil_step_06_key: null,
    civil_step_07_key: null,
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
    ...overrides,
  };
}

describe('auto-sort', () => {
  beforeEach(() => {
    poolMock.query.mockReset();
    poolMock.connect.mockClear();
    clientMock.query.mockReset();
    clientMock.release.mockClear();
    mockedClassify.mockReset();
  });

  it('auto-places when confidence ≥ 0.95 and slot empty', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [makePoleRow()] });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.97, reasoning: 'depth tape visible',
    });
    // Transaction queries on client
    clientMock.query.mockResolvedValue({ rowCount: 1 });

    const { req, res } = createMocks({
      method: 'POST',
      body: { pole_id: 'pole-1' },
    });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data.auto_placed).toBe(1);
    expect(body.data.suggested).toBe(0);
    expect(body.data.leftover).toBe(0);
    expect(body.data.results[0]).toMatchObject({
      photo_key: 'works-qa/proj-1/TEST/u1.jpg',
      predicted_slot: 'civil_03',
      action: 'auto-placed',
    });
    // Verify the UPDATE wrote to civil_step_03_key
    const updateSql = clientMock.query.mock.calls.find(c => /UPDATE pole_qa_photos/.test(String(c[0])))?.[0];
    expect(String(updateSql)).toMatch(/civil_step_03_key/);
    // Verify qa_correction_examples insert
    const insertSql = clientMock.query.mock.calls.find(c => /INSERT INTO qa_correction_examples/.test(String(c[0])))?.[0];
    expect(insertSql).toBeTruthy();
  });

  it('suggests when confidence in [0.6, 0.95)', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [makePoleRow()] });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.82, reasoning: 'looks like depth',
    });
    poolMock.query.mockResolvedValueOnce({ rowCount: 1 }); // suggestion UPDATE

    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1' } });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.suggested).toBe(1);
    expect(body.data.auto_placed).toBe(0);
    expect(body.data.results[0].action).toBe('suggested');

    const suggestSql = poolMock.query.mock.calls.find(c => /unassigned_suggestions/.test(String(c[0])))?.[0];
    expect(suggestSql).toBeTruthy();
  });

  it('leaves alone when confidence < 0.6', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [makePoleRow()] });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.4, reasoning: 'unclear',
    });

    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1' } });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.leftover).toBe(1);
    expect(body.data.auto_placed).toBe(0);
    expect(body.data.suggested).toBe(0);
    expect(body.data.results[0].action).toBe('leftover');
  });

  it('marks as leftover (not suggested) when slot is already filled — even high confidence', async () => {
    // Filled slots must never produce an Accept badge because the Accept flow
    // routes through move-photo whose swap overwrites the existing photo
    // (Johan WA 2026-05-22 15:08 — "autosort overwrite fotos by die civil").
    poolMock.query.mockResolvedValueOnce({
      rows: [makePoleRow({ civil_step_03_key: 'works-qa/already/here.jpg' })],
    });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.99, reasoning: 'strong match',
    });

    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'pole-1' } });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.suggested).toBe(0);
    expect(body.data.auto_placed).toBe(0);
    expect(body.data.leftover).toBe(1);
    expect(body.data.results[0].action).toBe('leftover');
    // No UPDATE should fire for the suggestion JSONB
    const suggestSql = poolMock.query.mock.calls.find(c => /unassigned_suggestions/.test(String(c[0])));
    expect(suggestSql).toBeUndefined();
  });

  it('returns 400 when pole_id missing', async () => {
    const { req, res } = createMocks({ method: 'POST', body: {} });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 404 when pole not found', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = createMocks({ method: 'POST', body: { pole_id: 'nope' } });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });
});
