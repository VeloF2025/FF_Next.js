/**
 * Tests for the portalRole admin gate on PUT /api/staff
 *
 * portalRole (staff.role — the /my portal role that gates Stores access) may
 * only be changed by admin/super_admin/system callers, and must be one of the
 * six StaffRole values or null to clear.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockUpdateStaff } = vi.hoisted(() => ({ mockUpdateStaff: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// Handler is wrapped in withAuth + withErrorHandler in production. Tests
// import the raw handler so provide passthroughs + pre-populate req.user.
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
}));
vi.mock('@/lib/api-error-handler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

vi.mock('@/services/staff/staffGetService', () => ({
  getStaffById: vi.fn(),
  getStaffList: vi.fn(),
}));
vi.mock('@/services/staff/staffCreateService', () => ({
  createStaff: vi.fn(),
  deleteStaffMember: vi.fn(),
}));
vi.mock('@/services/staff/staffUpdateDeleteService', () => ({
  updateStaff: mockUpdateStaff,
}));

import handler from '../../../pages/api/staff/index';

function makeRes(): Partial<NextApiResponse> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
}

function makePut(userRole: string, body: Record<string, unknown>): Partial<NextApiRequest> {
  return {
    method: 'PUT',
    query: { id: 'staff-123' },
    body,
    user: { id: 'user-1', role: userRole },
  } as Partial<NextApiRequest>;
}

describe('PUT /api/staff — portalRole gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateStaff.mockResolvedValue({ ok: true, data: { id: 'staff-123' } });
  });

  it('rejects portalRole changes from non-admin callers with 403', async () => {
    const res = makeRes();
    await handler(makePut('manager', { portalRole: 'stores' }) as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockUpdateStaff).not.toHaveBeenCalled();
  });

  it('rejects unknown portalRole values with 400', async () => {
    const res = makeRes();
    await handler(makePut('admin', { portalRole: 'banana' }) as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateStaff).not.toHaveBeenCalled();
  });

  it('rejects empty-string portalRole with 400 (null is the only clear sentinel)', async () => {
    const res = makeRes();
    await handler(makePut('admin', { portalRole: '' }) as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateStaff).not.toHaveBeenCalled();
  });

  it.each(['admin', 'super_admin', 'system'])('allows %s to set portalRole=stores', async (role) => {
    const res = makeRes();
    await handler(makePut(role, { portalRole: 'stores' }) as NextApiRequest, res as NextApiResponse);

    expect(mockUpdateStaff).toHaveBeenCalledWith('staff-123', { portalRole: 'stores' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows admin to clear portalRole with null', async () => {
    const res = makeRes();
    await handler(makePut('admin', { portalRole: null }) as NextApiRequest, res as NextApiResponse);

    expect(mockUpdateStaff).toHaveBeenCalledWith('staff-123', { portalRole: null });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('lets non-admin updates without portalRole pass through untouched', async () => {
    const res = makeRes();
    await handler(makePut('manager', { position: 'Technician' }) as NextApiRequest, res as NextApiResponse);

    expect(mockUpdateStaff).toHaveBeenCalledWith('staff-123', { position: 'Technician' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
