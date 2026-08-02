import type { NextApiRequest, NextApiResponse } from 'next';

export function makeReq(
  body: Record<string, unknown> = {},
  method: string = 'POST',
  userId: string | null = 'reviewer-1'
): NextApiRequest {
  const request: Partial<NextApiRequest> & { user?: { id: string } } = {
    method,
    query: {},
    headers: {},
    body,
  };
  if (userId) request.user = { id: userId };
  return request as NextApiRequest;
}

export function makeRes() {
  const captured: { statusCode: number; body?: unknown; headers: Record<string, string> } = {
    statusCode: 200,
    headers: {},
  };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

export const EXISTING = {
  adjustment: {
    id: 'adj-1',
    entry_id: 'e-1',
    requested_by: 'staff-1',
    adjustment_kind: 'forgot_clock_out' as const,
    adjusted_clock_in_at: null,
    adjusted_clock_out_at: '2026-04-20T14:00:00+00:00',
    adjusted_site_geofence_id: null,
    reason: 'forgot to clock out',
    status: 'pending' as const,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_at: '2026-04-20T15:00:00Z',
    updated_at: '2026-04-20T15:00:00Z',
  },
  entry: {
    id: 'e-1',
    staff_id: 'staff-1',
    work_date: '2026-04-20',
    clock_in_at: '2026-04-20T06:00:00+00:00',
    clock_out_at: null,
    status: 'open',
  },
};
