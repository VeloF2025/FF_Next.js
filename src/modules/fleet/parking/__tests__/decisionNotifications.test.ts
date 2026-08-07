import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const notifyMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
vi.mock('@/modules/notifications/services/notificationBus', () => ({
  notify: (...a: unknown[]) => notifyMock(...a),
}));

import { notifyParkingChangeDecided } from '../decisionNotifications';

const ARGS = {
  driverStaffId: 'staff-1',
  registration: 'LN40MGGP',
  outcome: 'approved' as const,
  decisionNote: null,
  requestId: 'req-1',
};

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([{ user_id: 'user-9' }]);
  notifyMock.mockReset().mockResolvedValue(undefined);
});

describe('notifyParkingChangeDecided', () => {
  it('notifies the requesting driver', async () => {
    await notifyParkingChangeDecided(ARGS);
    expect(notifyMock.mock.calls[0]![0]).toMatchObject({
      event_type: 'fleet.parking_change_decided',
      recipient_user_ids: ['user-9'],
      source_id: 'req-1',
      action_url: '/my/vehicle/parking',
    });
  });

  it('says which way it went, and carries the note', async () => {
    await notifyParkingChangeDecided({ ...ARGS, outcome: 'rejected', decisionNote: 'Too far' });
    const payload = notifyMock.mock.calls[0]![0] as { title: string; body: string };
    expect(`${payload.title} ${payload.body}`.toLowerCase()).toContain('declin');
    expect(payload.body).toContain('Too far');
  });

  /**
   * Field staff do not all have a users row — staff.user_id is nullable. The
   * bus addresses users, so there is simply nobody to notify. That is a logged
   * fact, not an error, and above all not a throw: the decision has already
   * been committed.
   */
  it('does no work when the driver has no linked user account', async () => {
    sqlMock.mockResolvedValue([{ user_id: null }]);
    await expect(notifyParkingChangeDecided(ARGS)).resolves.toBeUndefined();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does no work when the staff row is gone', async () => {
    sqlMock.mockResolvedValue([]);
    await notifyParkingChangeDecided(ARGS);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('swallows a bus failure', async () => {
    notifyMock.mockRejectedValue(new Error('bus down'));
    await expect(notifyParkingChangeDecided(ARGS)).resolves.toBeUndefined();
  });

  it('swallows a staff-lookup failure', async () => {
    sqlMock.mockRejectedValue(new Error('db down'));
    await expect(notifyParkingChangeDecided(ARGS)).resolves.toBeUndefined();
  });
});
