import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifyMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/notifications/services/notificationBus', () => ({ notify: notifyMock }));

import {
  buildDriverInputRequestedKey,
  buildDriverResponseReceivedKey,
  notifyDriverInputRequested,
  notifyDriverResponseReceived,
} from '../driverNotifications';

const INCIDENT = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SUBMISSION_ID = '55555555-5555-4555-8555-555555555555';
const DRIVER_USER = '44444444-4444-4444-8444-444444444444';
const MANAGER_A = '66666666-6666-4666-8666-666666666666';
const MANAGER_B = '77777777-7777-4777-8777-777777777777';

const requestNotificationRequest = { inputRequestId: REQUEST_ID, guidance: 'Please explain the late start', respondBy: '2026-08-12T21:59:59.999Z' };
const requestNotificationIncident = {
  incidentId: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', neutralLabel: 'Attendance timing needs review',
  projectLabel: 'Corridor A', siteLabel: 'Site 4',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('idempotency key builders', () => {
  it('matches the exact locked format for a driver-input-requested key', () => {
    expect(buildDriverInputRequestedKey(REQUEST_ID, DRIVER_USER)).toBe(`fleet-driver-input-requested:${REQUEST_ID}:${DRIVER_USER}`);
  });

  it('matches the exact locked format for a driver-response-received key', () => {
    expect(buildDriverResponseReceivedKey(SUBMISSION_ID, MANAGER_A)).toBe(`fleet-driver-response-received:${SUBMISSION_ID}:${MANAGER_A}`);
  });
});

describe('notifyDriverInputRequested', () => {
  it('sends one routine (in-app/email) notification to the driver with a neutral, non-disciplinary payload', async () => {
    notifyMock.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });

    const result = await notifyDriverInputRequested(requestNotificationRequest, requestNotificationIncident, DRIVER_USER);

    expect(result).toEqual({ delivered: 1, suppressed: 0, failed: 0 });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const payload = notifyMock.mock.calls[0]?.[0];
    expect(payload.event_type).toBe('fleet.driver_input_requested');
    expect(payload.recipient_user_ids).toEqual([DRIVER_USER]);
    expect(payload.idempotency_key).toBe(`fleet-driver-input-requested:${REQUEST_ID}:${DRIVER_USER}`);
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toMatch(/theft|fraud|misconduct|disciplinary|lat[^a-z]|lon[^a-z]|latitude|longitude/);
  });

  it('records a failure without throwing when the driver has no linked user account', async () => {
    const result = await notifyDriverInputRequested(requestNotificationRequest, requestNotificationIncident, null);

    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('never throws when notify() itself throws, and counts the recipient as failed', async () => {
    notifyMock.mockRejectedValue(new Error('bus unavailable'));

    const result = await notifyDriverInputRequested(requestNotificationRequest, requestNotificationIncident, DRIVER_USER);

    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
  });
});

describe('notifyDriverResponseReceived', () => {
  const submission = { submissionId: SUBMISSION_ID, submissionKind: 'response' as const };
  const incident = {
    incidentId: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', neutralLabel: 'Attendance timing needs review',
    projectLabel: 'Corridor A', siteLabel: 'Site 4',
  };

  it('sends one notification per recipient, each with its own idempotency key, and sums the results', async () => {
    notifyMock.mockResolvedValueOnce({ delivered: 1, suppressed: 0, failed: 0 });
    notifyMock.mockResolvedValueOnce({ delivered: 0, suppressed: 0, failed: 1 });

    const result = await notifyDriverResponseReceived(submission, incident, [MANAGER_A, MANAGER_B]);

    expect(result).toEqual({ delivered: 1, suppressed: 0, failed: 1 });
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock.mock.calls[0]?.[0].idempotency_key).toBe(`fleet-driver-response-received:${SUBMISSION_ID}:${MANAGER_A}`);
    expect(notifyMock.mock.calls[0]?.[0].recipient_user_ids).toEqual([MANAGER_A]);
    expect(notifyMock.mock.calls[1]?.[0].idempotency_key).toBe(`fleet-driver-response-received:${SUBMISSION_ID}:${MANAGER_B}`);
    expect(notifyMock.mock.calls[1]?.[0].event_type).toBe('fleet.driver_response_received');
  });

  it('records a failure without throwing when no recipient was resolved', async () => {
    const result = await notifyDriverResponseReceived(submission, incident, []);

    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('driver notification module boundary', () => {
  it('never exports an incident-opened notification for a driver (design: drivers are notified only after a manager requests input)', async () => {
    const module = await import('../driverNotifications');
    const exportedNames = Object.keys(module);
    expect(exportedNames.some((name) => /opened/i.test(name))).toBe(false);
  });
});
