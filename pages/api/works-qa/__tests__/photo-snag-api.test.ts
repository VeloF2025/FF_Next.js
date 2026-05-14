// Integration tests for the works-qa photo-snag API routes.
//
// Strategy: mock the service layer + auth wrappers so we exercise the route's
// own validation/permission/error-mapping logic. The service-layer behaviour
// itself is covered by src/modules/works-qa/__tests__/photoSnagService.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { poolMock } = vi.hoisted(() => ({ poolMock: { query: vi.fn() } }));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

vi.mock('@/lib/db', () => ({ default: poolMock, pool: poolMock }));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const serviceMocks = vi.hoisted(() => ({
  approvePhoto: vi.fn(),
  createPhotoSnag: vi.fn(),
  resolvePhotoSnag: vi.fn(),
  listPhotoSnags: vi.fn(),
  getPoleSnagReport: vi.fn(),
}));

vi.mock('@/modules/works-qa/services/photoSnagService', () => ({
  approvePhoto: serviceMocks.approvePhoto,
  createPhotoSnag: serviceMocks.createPhotoSnag,
  resolvePhotoSnag: serviceMocks.resolvePhotoSnag,
  listPhotoSnags: serviceMocks.listPhotoSnags,
  getPoleSnagReport: serviceMocks.getPoleSnagReport,
}));

const logActivityMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/noc/services/ticketService', () => ({
  logTicketActivity: logActivityMock,
}));

import approveHandler from '../photo-approve';
import snagHandler from '../photo-snag';
import resolveHandler from '../photo-snag-resolve';
import listHandler from '../photo-snags';
import reportHandler from '../pole-snag-report';
import assignablesHandler from '../assignable-users';

const TEST_USER = {
  id: 'user-uuid-1', userId: 'user-uuid-1',
  email: 'hein@velocityfibre.co.za', firstName: 'Hein', lastName: 'V',
  name: 'Hein V', role: 'super_admin', permissions: [],
};

function withUser<T extends NextApiRequest>(req: T): T {
  (req as unknown as { user: typeof TEST_USER; sessionId: string }).user = TEST_USER;
  (req as unknown as { user: typeof TEST_USER; sessionId: string }).sessionId = 'sess-1';
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolMock.query.mockReset();
});

const body = (b: Record<string, unknown>) => JSON.parse(JSON.stringify(b));

describe('POST /api/works-qa/photo-approve', () => {
  it('rejects non-POST', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await approveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(405);
  });
  it('400 on missing pole_qa_photo_id', async () => {
    const { req, res } = createMocks({ method: 'POST', body: { slot_key: 'civil_03' } });
    await approveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(422);
  });
  it('returns slot_approvals on success', async () => {
    serviceMocks.approvePhoto.mockResolvedValue({ civil_03: { decision: 'approved', by: 'user-uuid-1', at: 'now' } });
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03' }) });
    await approveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.data.slot_approvals.civil_03.decision).toBe('approved');
    expect(serviceMocks.approvePhoto).toHaveBeenCalledWith({
      poleQaPhotoId: 'p1', slotKey: 'civil_03', approvedBy: 'user-uuid-1',
    });
  });
  it('maps "Unknown slot key" → 400', async () => {
    serviceMocks.approvePhoto.mockRejectedValue(new Error('Unknown slot key: nope'));
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'nope' }) });
    await approveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(422);
  });
});

describe('POST /api/works-qa/photo-snag', () => {
  it('400 when comment is empty', async () => {
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03', comment: '   ' }) });
    await snagHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(422);
  });
  it('400 on invalid severity', async () => {
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03', comment: 'x', severity: 'bogus' }) });
    await snagHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(422);
  });
  it('auto-assigns site manager when no assignee passed', async () => {
    // First pool.query → getPoleProjectId; second → resolveSiteManagerUserId
    poolMock.query
      .mockResolvedValueOnce({ rows: [{ project_id: 'proj-1' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-mgr-9' }] });
    serviceMocks.createPhotoSnag.mockResolvedValue({
      status: 'created',
      snag: { id: 'snag-1', noc_ticket_id: 'tkt-1' },
      ticket: { id: 'tkt-1' },
      slotApprovals: {},
    });
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03', comment: 'Depth shallow' }) });
    await snagHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const call = serviceMocks.createPhotoSnag.mock.calls[0]![0];
    expect(call.assignedToUserId).toBe('user-mgr-9');
  });
  it('returns 409 on duplicate when amend not set', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [{ project_id: 'proj-1' }] }).mockResolvedValueOnce({ rows: [] });
    serviceMocks.createPhotoSnag.mockResolvedValue({
      status: 'duplicate',
      snag: { id: 'snag-existing', noc_ticket_id: 'tkt-existing' },
      slotApprovals: {},
    });
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03', comment: 'second attempt' }) });
    await snagHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(409);
    expect(logActivityMock).not.toHaveBeenCalled();
  });
  it('amend mode: appends a note to the linked ticket on duplicate', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [{ project_id: 'proj-1' }] }).mockResolvedValueOnce({ rows: [] });
    serviceMocks.createPhotoSnag.mockResolvedValue({
      status: 'duplicate',
      snag: { id: 'snag-existing', noc_ticket_id: 'tkt-existing' },
      slotApprovals: {},
    });
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03', comment: 'also pole is leaning', amend: true }) });
    await snagHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.data.status).toBe('amended');
    expect(payload.data.note_appended).toBe(true);
    expect(logActivityMock).toHaveBeenCalledTimes(1);
    expect(logActivityMock.mock.calls[0]![0]).toMatchObject({
      ticketId: 'tkt-existing', activityType: 'note',
    });
    expect(logActivityMock.mock.calls[0]![0].description).toContain('also pole is leaning');
  });

  it('amend mode with no linked ticket: note_appended=false (no silent success)', async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [{ project_id: 'proj-1' }] }).mockResolvedValueOnce({ rows: [] });
    serviceMocks.createPhotoSnag.mockResolvedValue({
      status: 'duplicate',
      snag: { id: 'snag-orphan', noc_ticket_id: null },
      slotApprovals: {},
    });
    const { req, res } = createMocks({ method: 'POST', body: body({ pole_qa_photo_id: 'p1', slot_key: 'civil_03', comment: 'amend orphan', amend: true }) });
    await snagHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.data.status).toBe('amended');
    expect(payload.data.note_appended).toBe(false);
    expect(logActivityMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/works-qa/photo-snag-resolve', () => {
  it('defaults closeTicket=true when omitted', async () => {
    serviceMocks.resolvePhotoSnag.mockResolvedValue({ snag: { id: 'snag-1', status: 'verified' }, ticketResolved: true });
    const { req, res } = createMocks({ method: 'POST', body: body({ snag_id: 'snag-1' }) });
    await resolveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    expect(serviceMocks.resolvePhotoSnag.mock.calls[0]![0].closeTicket).toBe(true);
  });
  it('respects closeTicket=false', async () => {
    serviceMocks.resolvePhotoSnag.mockResolvedValue({ snag: { id: 'snag-1' }, ticketResolved: false });
    const { req, res } = createMocks({ method: 'POST', body: body({ snag_id: 'snag-1', close_ticket: false }) });
    await resolveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(serviceMocks.resolvePhotoSnag.mock.calls[0]![0].closeTicket).toBe(false);
  });
  it('maps "snag not found" → 404', async () => {
    serviceMocks.resolvePhotoSnag.mockRejectedValue(new Error('works-qa snag not found: snag-x'));
    const { req, res } = createMocks({ method: 'POST', body: body({ snag_id: 'snag-x' }) });
    await resolveHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(404);
  });
});

describe('GET /api/works-qa/photo-snags', () => {
  it('400 when pole_id missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });
    await listHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(422);
  });
  it('returns snags array', async () => {
    serviceMocks.listPhotoSnags.mockResolvedValue([{ id: 'snag-1', ticket_uid: 'WQA-20260514-001' }]);
    const { req, res } = createMocks({ method: 'GET', query: { pole_id: 'p1' } });
    await listHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.data.snags).toHaveLength(1);
  });
});

describe('GET /api/works-qa/pole-snag-report', () => {
  it('returns the aggregate report', async () => {
    serviceMocks.getPoleSnagReport.mockResolvedValue({
      pole: { id: 'p1', pole_label: 'MAM.P.A033', zone_no: 6, pon_no: 67, project_id: 'proj-1' },
      totals: { total: 21, approved: 5, snagged: 2, pending: 14 },
      snags: [],
      report_id: 'rep-1',
      generated_at: '2026-05-14T16:00:00Z',
    });
    const { req, res } = createMocks({ method: 'GET', query: { pole_id: 'p1' } });
    await reportHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.data.totals.snagged).toBe(2);
    expect(serviceMocks.getPoleSnagReport).toHaveBeenCalledWith('p1', 'user-uuid-1');
  });
});

describe('GET /api/works-qa/assignable-users', () => {
  it('400 when project_id missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });
    await assignablesHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(422);
  });
  it('resolves staff.user_id → users.id and filters roles in SQL', async () => {
    // Service returns whatever the SQL already filtered — the handler trusts the DB.
    poolMock.query.mockResolvedValueOnce({ rows: [
      { user_id: 'u-1', name: 'Jane Site', email: 'jane@x', role: 'Site Manager' },
      { user_id: 'u-3', name: 'Mary QA',   email: 'mary@x', role: 'QA Manager' },
    ] });
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1' } });
    await assignablesHandler(withUser(req as unknown as NextApiRequest), res as unknown as NextApiResponse);
    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    const ids = payload.data.users.map((u: { user_id: string }) => u.user_id);
    expect(ids).toEqual(['u-1', 'u-3']);
    const [sql, params] = poolMock.query.mock.calls[0]! as [string, unknown[]];
    expect(sql).toMatch(/JOIN staff s ON s\.id::text = vpt\.person_id/);  // FK bridge present
    expect(sql).toMatch(/s\.user_id IS NOT NULL/);
    expect(sql).toMatch(/LOWER\(vpt\.role\) = ANY\(\$2/);                 // filter moved to SQL
    expect(params[1]).toEqual(expect.arrayContaining(['site manager', 'project manager', 'qa manager']));
  });
});
