import { describe, expect, it, beforeEach, vi } from 'vitest';

const permissionCalls: Array<[string, string]> = [];
const submitPonByNumber = vi.fn();

vi.mock('@/lib/db', () => ({ default: {} }));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (permission: string, action: string) => {
    permissionCalls.push([permission, action]);
    return (handler: (req: unknown, res: unknown) => unknown) => handler;
  },
}));

vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryService', () => ({
  createZoneDeliveryService: () => ({}),
}));

vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryPonSubmit', () => ({
  submitPonByNumber,
}));

const load = async () => (await import('../pon-submit')).default;

const response = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return res;
};

beforeEach(() => {
  permissionCalls.length = 0;
  submitPonByNumber.mockReset().mockResolvedValue({ rowVersion: 1, pons: [] });
  vi.resetModules();
});

describe('POST /api/zone-delivery/pon-submit', () => {
  it('is gated on the permission that governs the milestone it records', async () => {
    await load();
    // port_submitted is an operations milestone; anything weaker would let a
    // role that cannot confirm the milestone record it by another route.
    expect(permissionCalls).toContainEqual([
      'construction-qa.zone-delivery.operations-confirm',
      'edit',
    ]);
  });

  it('rejects anything but POST', async () => {
    const handler = await load();
    const res = response();
    await handler({ method: 'GET', body: {} } as never, res as never);

    expect(res.statusCode).toBe(405);
    expect(submitPonByNumber).not.toHaveBeenCalled();
  });

  it('passes the session user as the actor, never a body-supplied one', async () => {
    const handler = await load();
    const res = response();
    await handler({
      method: 'POST',
      body: {
        projectId: '11111111-1111-1111-1111-111111111111',
        zoneNo: 20,
        ponNo: 212,
        effectiveAt: new Date().toISOString(),
        source: 'works-qa-toolbar',
        // Attacker-supplied identity fields must be ignored.
        userId: 'attacker',
        email: 'attacker@evil.example',
      },
      user: { id: 'real-user', email: 'real@vf.co.za' },
    } as never, res as never);

    expect(submitPonByNumber).toHaveBeenCalledTimes(1);
    const actor = submitPonByNumber.mock.calls[0]![3];
    expect(actor).toEqual({
      userId: 'real-user',
      email: 'real@vf.co.za',
      permission: 'construction-qa.zone-delivery.operations-confirm',
    });
  });

  it('surfaces a validation failure as a 4xx rather than a 500', async () => {
    // The real parser runs here: an empty body must be rejected as a client
    // error, not surface as an unhandled server fault.
    const handler = await load();
    const res = response();
    await handler({ method: 'POST', body: {}, user: { id: 'u', email: 'e' } } as never, res as never);

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(submitPonByNumber).not.toHaveBeenCalled();
  });
});
