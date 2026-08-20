/**
 * State-machine guard tests for PUT /api/procurement/stock-takes/[id].
 *
 * Status transitions must go through the actions endpoint (start/complete/
 * approve/cancel), which enforces completeness and applies stock adjustments.
 * A bare PUT must not be able to set status='approved' (skipping adjustments)
 * or reopen an approved take (status='draft'), which would double-apply
 * adjustments on the next approval.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const mocks = vi.hoisted(() => ({ neonTag: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mocks.neonTag }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, AuthenticatedRequest: class {} }));

import handler from '@/pages/api/procurement/stock-takes/[id]';

function put(existingStatus: string, body: Record<string, unknown>) {
  // First neon call in handlePut is the existence/status lookup.
  mocks.neonTag.mockResolvedValueOnce([{ id: 'take-1', status: existingStatus }]);
  // Any subsequent UPDATE returns a row (only reached if the guard passes).
  mocks.neonTag.mockResolvedValue([{ id: 'take-1', status: existingStatus }]);
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PUT',
    query: { id: 'take-1' },
    body,
  });
  return (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

describe('PUT stock-take status guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects PUT {status:"approved"} on a pending_review take', async () => {
    const res = await put('pending_review', { status: 'approved' });
    expect(res._getStatusCode()).toBe(400);
  });

  it('rejects reopening an approved take via PUT {status:"draft"}', async () => {
    const res = await put('approved', { status: 'draft' });
    expect(res._getStatusCode()).toBe(400);
  });

  it('rejects any edit of an approved take', async () => {
    const res = await put('approved', { name: 'renamed' });
    expect(res._getStatusCode()).toBe(400);
  });

  it('allows a metadata edit on a draft take (no status field)', async () => {
    const res = await put('draft', { name: 'renamed' });
    expect(res._getStatusCode()).toBe(200);
  });
});
