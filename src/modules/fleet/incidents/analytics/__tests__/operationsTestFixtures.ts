/**
 * Shared fixtures for the operations read-path tests.
 *
 * Pure builders and ids only — every `vi.mock` stays in the test file that
 * relies on it, because a mock hoisted out of sight is a mock nobody checks.
 */
import type { IncidentFact, MonitorRunFact, NotificationFact, PresenceFact } from '../facts';
import type { OperationsFilters } from '../types';

export const USER = '11111111-1111-4111-8111-111111111111';
export const STAFF = '22222222-2222-4222-8222-222222222222';
export const PROJECT = '33333333-3333-4333-8333-333333333333';
export const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444';
export const SITE = '55555555-5555-4555-8555-555555555555';
export const DRIVER = '66666666-6666-4666-8666-666666666666';
export const MANAGER = '77777777-7777-4777-8777-777777777777';

export const viewer = { userId: USER, staffId: STAFF, role: 'project_manager' };

/**
 * 2026-08-24. The purge cutoff twelve months back is 2025-08-24, which falls
 * mid-month, so the first FULLY retained month is 2025-09-01.
 */
export const NOW = '2026-08-24T09:00:00.000Z';
export const RETAINED_FROM = '2025-09-01';

export function incident(overrides: Partial<IncidentFact> = {}): IncidentFact {
  return {
    kind: 'incident', workDate: '2026-08-10',
    dimension: { projectId: PROJECT, operationalSiteId: SITE },
    contributorKey: DRIVER, incidentId: 'aaaaaaa1-0000-4000-8000-000000000001',
    severity: 'high', vehicleId: null, incidentType: 'late', outcome: 'confirmed',
    acknowledgementSeconds: 120, reviewStartSeconds: null, resolutionSeconds: null,
    driverResponseSeconds: null, driverInputRequested: false, driverInputResponded: false,
    driverInputOnTime: false, evidenceAvailable: true, isRecurrence: false,
    ...overrides,
  };
}

export function presence(overrides: Partial<PresenceFact> = {}): PresenceFact {
  return {
    kind: 'presence', workDate: '2026-08-10',
    dimension: { projectId: PROJECT, operationalSiteId: SITE },
    contributorKey: DRIVER, confirmation: 'confirmed',
    ...overrides,
  };
}

export function monitorRun(overrides: Partial<MonitorRunFact> = {}): MonitorRunFact {
  return {
    kind: 'monitor_run', workDate: '2026-08-10',
    dimension: { projectId: PROJECT, operationalSiteId: SITE },
    contributorKeys: [DRIVER], completed: true,
    ...overrides,
  };
}

export function notification(overrides: Partial<NotificationFact> = {}): NotificationFact {
  return {
    kind: 'notification', workDate: '2026-08-10',
    dimension: { projectId: PROJECT, operationalSiteId: SITE },
    contributorKey: DRIVER, delivered: true,
    ...overrides,
  };
}

export function filters(overrides: Partial<OperationsFilters> = {}): OperationsFilters {
  return { start: '2026-08-01', end: '2026-08-31', ...overrides };
}
