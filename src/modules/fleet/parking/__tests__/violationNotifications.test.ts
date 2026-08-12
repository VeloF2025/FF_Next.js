import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParkingCheckReport } from '../types';

const notify = vi.hoisted(() => vi.fn());
vi.mock('@/modules/notifications/services/notificationBus', () => ({ notify }));

import { fleetAlertUserIds } from '../alertRecipients';
import { notifyNewParkingViolations } from '../violationNotifications';

const USER = '11111111-1111-4111-8111-111111111111';
const report: ParkingCheckReport = {
  checkDate: '2026-08-11', evaluated: 3, errors: 0,
  counts: { compliant: 1, violation: 2, unknown: 0, not_verifiable: 0, no_address: 0 },
  results: [
    { vehicleId: 'veh-1', registration: 'AA11BBGP', result: 'violation', distanceM: 1234.5, lastFixAgeSeconds: 60, inserted: true, previousResult: null, newViolation: true },
    { vehicleId: 'veh-2', registration: 'AA22BBGP', result: 'violation', distanceM: 300, lastFixAgeSeconds: 60, inserted: false, previousResult: 'violation', newViolation: false },
    { vehicleId: 'veh-3', registration: 'AA33BBGP', result: 'compliant', distanceM: 0, lastFixAgeSeconds: 60, inserted: true, previousResult: null, newViolation: false },
  ],
};

describe('Fleet violation notifications', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.FLEET_ALERT_USER_IDS = USER; notify.mockResolvedValue({ accepted_recipients: 1, suppressed_recipients: 0, failed_recipients: 0 }); });

  it('normalizes valid unique recipient UUIDs', () => {
    expect(fleetAlertUserIds(undefined)).toEqual([]);
    expect(fleetAlertUserIds(`bad,${USER},${USER}`)).toEqual([USER]);
  });

  it('notifies only newly recorded violations without private location data', async () => {
    expect(await notifyNewParkingViolations(report)).toEqual({ warnings: 0, notifiedViolations: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'fleet.parking_violation',
      action_url: '/fleet/parking?date=2026-08-11&result=violation',
      source_module: 'fleet', source_id: 'veh-1:2026-08-11',
      idempotency_key: 'parking-violation:veh-1:2026-08-11',
      recipient_user_ids: [USER],
    }));
    expect(JSON.stringify(notify.mock.calls[0])).not.toMatch(/lastFixLat|lastFixLon|@/);
  });

  it('turns missing recipients into warnings without throwing', async () => {
    delete process.env.FLEET_ALERT_USER_IDS;
    expect(await notifyNewParkingViolations(report)).toEqual({ warnings: 1, notifiedViolations: 0 });
  });

  it('counts bus failures but not duplicate suppression as warnings', async () => {
    notify.mockResolvedValue({ accepted_recipients: 0, suppressed_recipients: 1, failed_recipients: 2 });
    expect(await notifyNewParkingViolations(report)).toEqual({ warnings: 2, notifiedViolations: 0 });
  });
});
