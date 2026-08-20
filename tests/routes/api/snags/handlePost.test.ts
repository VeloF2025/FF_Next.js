import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql, recalculateForSnag, updateTicket, authorization } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  recalculateForSnag: vi.fn(),
  updateTicket: vi.fn(),
  authorization: { allowPatch: true },
}));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));
vi.mock('@/lib/db', () => ({ default: {} }));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (permission: string, action: string) =>
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
      (req: NextApiRequest, res: NextApiResponse) => {
        if (!authorization.allowPatch) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: `${permission}:${action}` },
          });
        }
        return handler(req, res);
      },
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/noc/services/ticketService', () => ({ updateTicket }));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryService', () => ({
  createZoneDeliveryService: () => ({ recalculateForSnag }),
}));

import handler from '@/pages/api/snags/index';
import { TicketStatus } from '@/modules/noc/types/ticket';

function makeRes() {
  const res: Partial<NextApiResponse> & { jsonData?: unknown; statusCode?: number } = {};
  res.status = vi.fn((code: number) => { res.statusCode = code; return res as NextApiResponse; });
  res.json = vi.fn((data: unknown) => { res.jsonData = data; return res as NextApiResponse; });
  return res as NextApiResponse & { jsonData?: unknown; statusCode?: number };
}

describe('POST /api/snags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a verification snag without report_id, auto-generates snag_number, skips snag_reports UPDATE', async () => {
    // Single atomic INSERT...SELECT — no separate SELECT next_num call
    mockSql
      .mockResolvedValueOnce([{ id: 'snag-uuid', snag_number: 42, category: 'verification', status: 'open' }]);

    const req = {
      method: 'POST',
      body: {
        project_id: 'proj-uuid',
        category: 'verification',
        description: 'Confirm if pole is planted on site',
        pole_references: ['MOA.P.D134'],
        pole_qa_photo_id: 'pole-uuid',
        severity: 'minor',
      },
    } as unknown as NextApiRequest;

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(201);
    // Exactly 1 SQL call: the atomic INSERT...SELECT. No UPDATE snag_reports.
    expect(mockSql).toHaveBeenCalledTimes(1);

    // The single atomic INSERT...SELECT must carry source='works_qa', category='verification',
    // and pole_qa_photo_id='pole-uuid'. In neon's tagged-template call the first arg is the
    // TemplateStringsArray and the remaining args are the interpolated values.
    const insertCallArgs = mockSql.mock.calls[0];
    // 'works_qa' is a SQL literal hardcoded in the template string (not an interpolated param)
    const sqlString = insertCallArgs[0].join('');
    expect(sqlString).toContain("'works_qa'");
    // Interpolated values are args 1..N
    const interpolatedValues = insertCallArgs.slice(1).flat();
    expect(interpolatedValues).toContain('verification');
    expect(interpolatedValues).toContain('pole-uuid');
  });

  it('rejects a non-verification snag with no report_id with 400', async () => {
    const req = {
      method: 'POST',
      body: {
        project_id: 'proj-uuid',
        category: 'quality',
        description: 'Bad weld',
        pole_references: ['MOA.P.D134'],
      },
    } as unknown as NextApiRequest;

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects non-verification snags missing snag_number', async () => {
    const req = {
      method: 'POST',
      body: {
        project_id: 'proj-uuid',
        report_id: 'report-uuid',
        category: 'quality',
        description: 'Bad weld',
        pole_references: ['MOA.P.D134'],
      },
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/snags zone delivery recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.allowPatch = true;
  });

  it('recalculates linked zones after a status change with the verified permission actor', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'open' }])
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'closed', noc_ticket_id: null }]);
    const req = {
      method: 'PATCH',
      body: { id: 'snag-uuid', status: 'closed' },
      user: { id: 'user-uuid', email: 'qa@example.com' },
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(recalculateForSnag).toHaveBeenCalledWith('snag-uuid', {
      userId: 'user-uuid',
      email: 'qa@example.com',
      permission: 'construction-qa.snags',
    });
  });

  it('returns failure when linked-zone recalculation fails', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'open' }])
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'closed', noc_ticket_id: null }]);
    recalculateForSnag.mockRejectedValueOnce(new Error('recalculation unavailable'));
    const req = {
      method: 'PATCH',
      body: { id: 'snag-uuid', status: 'closed' },
      user: { id: 'user-uuid', email: 'qa@example.com' },
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });

  it('retries recalculation for a same-status request', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'closed' }])
      .mockResolvedValueOnce([{
        id: 'snag-uuid',
        status: 'closed',
        closed_at: '2026-07-01T08:00:00.000Z',
        noc_ticket_id: null,
      }]);
    const req = {
      method: 'PATCH',
      body: { id: 'snag-uuid', status: 'closed' },
      user: { id: 'user-uuid', email: 'qa@example.com' },
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(recalculateForSnag).toHaveBeenCalledOnce();
    expect(res.jsonData).toMatchObject({
      data: { closed_at: '2026-07-01T08:00:00.000Z' },
    });
  });

  it('denies PATCH before mutation without construction-qa.snags edit', async () => {
    authorization.allowPatch = false;
    const req = {
      method: 'PATCH',
      body: { id: 'snag-uuid', status: 'closed' },
      user: { id: 'user-uuid', email: 'qa@example.com' },
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.jsonData).toMatchObject({
      error: { message: 'construction-qa.snags:edit' },
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('preserves resolved NOC sync semantics after the status-side-effect extraction', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'open' }])
      .mockResolvedValueOnce([{ id: 'snag-uuid', status: 'closed', noc_ticket_id: 'ticket-uuid' }]);
    updateTicket.mockResolvedValueOnce({ id: 'ticket-uuid' });
    const req = {
      method: 'PATCH',
      body: { id: 'snag-uuid', status: 'closed' },
      user: { id: 'user-uuid', email: 'qa@example.com' },
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(updateTicket).toHaveBeenCalledWith('ticket-uuid', {
      status: TicketStatus.RESOLVED,
      resolved_at: expect.any(Date),
    });
  });
});
