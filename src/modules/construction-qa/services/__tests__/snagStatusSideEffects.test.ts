import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recalculateForSnag: vi.fn(),
  updateTicket: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: h.logError, warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/noc/services/ticketService', () => ({
  updateTicket: h.updateTicket,
}));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryService', () => ({
  createZoneDeliveryService: () => ({
    recalculateForSnag: h.recalculateForSnag,
  }),
}));

import { runSnagStatusSideEffects } from '../snagStatusSideEffects';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'qa@example.com',
  permission: 'construction-qa.snags',
};

describe('runSnagStatusSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries Zone Delivery reconciliation for the same requested status', async () => {
    await runSnagStatusSideEffects({
      snagId: 'snag-1',
      previousStatus: 'closed',
      requestedStatus: 'closed',
      actor,
    });
    expect(h.recalculateForSnag).toHaveBeenCalledWith('snag-1', actor);
  });

  it('propagates a Zone Delivery reconciliation failure', async () => {
    const error = new Error('recalculation unavailable');
    h.recalculateForSnag.mockRejectedValueOnce(error);
    await expect(runSnagStatusSideEffects({
      snagId: 'snag-1',
      previousStatus: 'open',
      requestedStatus: 'closed',
      actor,
    })).rejects.toBe(error);
    expect(h.logError).toHaveBeenCalledWith(
      'Zone delivery snag recalculation failed',
      expect.objectContaining({ snagId: 'snag-1' }),
    );
  });

  it('preserves best-effort NOC sync while still reconciling Zone Delivery', async () => {
    h.updateTicket.mockRejectedValueOnce(new Error('NOC unavailable'));
    await runSnagStatusSideEffects({
      snagId: 'snag-1',
      previousStatus: 'open',
      requestedStatus: 'closed',
      nocTicketId: 'ticket-1',
      actor,
    });
    expect(h.updateTicket).toHaveBeenCalledOnce();
    expect(h.recalculateForSnag).toHaveBeenCalledOnce();
  });
});
