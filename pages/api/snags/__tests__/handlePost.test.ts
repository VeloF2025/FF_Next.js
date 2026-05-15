import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, withPermission: () => (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/noc/services/ticketService', () => ({ updateTicket: vi.fn() }));

import handler from '../index';

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
    // First call: SELECT next_num; second call: INSERT RETURNING
    mockSql
      .mockResolvedValueOnce([{ next_num: 42 }])
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
    // Exactly 2 SQL calls: SELECT next_num + INSERT. No UPDATE snag_reports.
    expect(mockSql).toHaveBeenCalledTimes(2);
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
});
