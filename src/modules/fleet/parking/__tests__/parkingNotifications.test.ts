import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const notifyMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
vi.mock('@/modules/notifications/services/notificationBus', () => ({
  notify: (...a: unknown[]) => notifyMock(...a),
}));

import { notifyParkingChangeRequested } from '../parkingNotifications';

const ARGS = { registration: 'LN40MGGP', driverName: 'Thabo M', declarationId: 'loc-1' };

beforeEach(() => {
  sqlMock.mockReset();
  notifyMock.mockReset();
  notifyMock.mockResolvedValue(undefined);
});

describe('notifyParkingChangeRequested', () => {
  it('notifies every user whose role can approve', async () => {
    sqlMock.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    await notifyParkingChangeRequested(ARGS);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![0]).toMatchObject({
      event_type: 'fleet.parking_change_requested',
      source_module: 'fleet',
      source_id: 'loc-1',
      action_url: '/fleet/parking/requests',
      recipient_user_ids: ['user-1', 'user-2'],
    });
  });

  it('names the driver and the vehicle in the message', async () => {
    sqlMock.mockResolvedValue([{ id: 'user-1' }]);
    await notifyParkingChangeRequested(ARGS);
    const payload = notifyMock.mock.calls[0]![0] as { title: string; body: string };
    expect(payload.title).toContain('LN40MGGP');
    expect(payload.body).toContain('Thabo M');
  });

  it('falls back to a generic subject when the driver name is unknown', async () => {
    sqlMock.mockResolvedValue([{ id: 'user-1' }]);
    await notifyParkingChangeRequested({ ...ARGS, driverName: null });
    const payload = notifyMock.mock.calls[0]![0] as { body: string };
    expect(payload.body).toContain('A driver');
  });

  // The bus warns and no-ops on an empty recipient list; calling it with one
  // buys nothing and hides the real problem, which is that nobody holds the
  // permission.
  it('does not call the bus when no approver exists', async () => {
    sqlMock.mockResolvedValue([]);
    await notifyParkingChangeRequested(ARGS);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  // A parking request that succeeded must not 500 because the bell is down.
  it('swallows a bus failure', async () => {
    sqlMock.mockResolvedValue([{ id: 'user-1' }]);
    notifyMock.mockRejectedValue(new Error('bus down'));
    await expect(notifyParkingChangeRequested(ARGS)).resolves.toBeUndefined();
  });

  it('swallows a recipient-lookup failure', async () => {
    sqlMock.mockRejectedValue(new Error('db down'));
    await expect(notifyParkingChangeRequested(ARGS)).resolves.toBeUndefined();
  });
});
