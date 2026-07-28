/**
 * Exercises the REAL role-hierarchy comparison in withRole.
 *
 * Route tests that stub `withRole` to a passthrough (capturing the role string)
 * only pin which role is wired to a route — they cannot tell whether the
 * wrapper actually enforces it. Nothing else in the repo covered the
 * `ROLE_HIERARCHY[user] < ROLE_HIERARCHY[required]` comparison, so inverting or
 * weakening it would have left every "is gated at super_admin" test green while
 * the gate did nothing.
 *
 * This is shared middleware — a regression here silently downgrades access
 * control on every route that uses it, not just the WhatsApp admin ones.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { withRole } from '../middleware';
import type { AuthRole } from '../types';

function callAs(role: AuthRole, required: AuthRole) {
  const handler = vi.fn(async (_req: NextApiRequest, res: NextApiResponse) => {
    res.status(200).json({ success: true });
  });

  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET' });
  (req as unknown as { user: unknown }).user = { role, email: `${role}@example.test` };

  return Promise.resolve(withRole(required)(handler)(req, res)).then(() => ({ res, handler }));
}

const ALL_ROLES: AuthRole[] = [
  'viewer',
  'technician',
  'storeman',
  'manager',
  'admin',
  'system',
  'super_admin',
];

describe('withRole — real hierarchy enforcement', () => {
  it.each(ALL_ROLES.filter((r) => r !== 'super_admin'))(
    'blocks %s from a super_admin route with 403 and never calls the handler',
    async (role) => {
      const { res, handler } = await callAs(role, 'super_admin');

      expect(res._getStatusCode()).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it('allows super_admin through a super_admin route', async () => {
    const { res, handler } = await callAs('super_admin', 'super_admin');

    expect(res._getStatusCode()).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each<AuthRole>(['viewer', 'technician', 'storeman'])(
    'blocks %s from a manager route',
    async (role) => {
      const { res, handler } = await callAs(role, 'manager');

      expect(res._getStatusCode()).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it.each<AuthRole>(['manager', 'admin', 'super_admin'])(
    'allows %s through a manager route',
    async (role) => {
      const { res, handler } = await callAs(role, 'manager');

      expect(res._getStatusCode()).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    }
  );

  // An unrecognised role must not be treated as privileged.
  it('blocks an unknown role rather than defaulting it open', async () => {
    const { res, handler } = await callAs('not-a-real-role' as AuthRole, 'manager');

    expect(res._getStatusCode()).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
