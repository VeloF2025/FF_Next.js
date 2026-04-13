// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken } from '@/lib/auth';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-chars-ok';
});

const baseUser = {
  id: 'user-123',
  userId: 'user-123',
  email: 'target@test.com',
  firstName: 'Target',
  lastName: 'User',
  name: 'Target User',
  role: 'technician' as const,
  permissions: [],
  isActive: true,
};

describe('signToken — impersonation params', () => {
  it('includes isImpersonation=true and impersonatedBy in payload when flag passed', async () => {
    const token = await signToken(baseUser, 'sess-abc', '1h', {
      isImpersonation: true,
      impersonatedBy: 'admin-456',
    });
    const payload = await verifyToken(token);
    expect(payload?.isImpersonation).toBe(true);
    expect(payload?.impersonatedBy).toBe('admin-456');
  });

  it('does NOT include isImpersonation for normal tokens', async () => {
    const token = await signToken(baseUser, 'sess-xyz', '24h');
    const payload = await verifyToken(token);
    expect(payload?.isImpersonation).toBeUndefined();
    expect(payload?.impersonatedBy).toBeUndefined();
  });
});

describe('createImpersonationSession export', () => {
  it('is exported from @/lib/auth', async () => {
    const { createImpersonationSession } = await import('@/lib/auth');
    expect(typeof createImpersonationSession).toBe('function');
  });
});

describe('POST /api/admin/impersonate — module exists', () => {
  it('exports a default handler function', async () => {
    // Dynamic import to avoid DB connection at module load
    const mod = await import('../../../pages/api/admin/impersonate');
    expect(typeof mod.default).toBe('function');
  });
});
