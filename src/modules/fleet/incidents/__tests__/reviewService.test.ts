import { beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn() }));
vi.mock('../reviewScope', () => ({ resolveIncidentScope: scope.resolveIncidentScope, isProjectOwnedByScope: scope.isProjectOwnedByScope }));

const queries = vi.hoisted(() => ({
  listIncidents: vi.fn(), getIncidentCore: vi.fn(), getIncidentActions: vi.fn(),
  getIncidentEvidence: vi.fn(), getIncidentDeliverySummary: vi.fn(),
}));
vi.mock('../reviewQueries', () => queries);

const transitions = vi.hoisted(() => ({ runIncidentTransition: vi.fn(), runBulkAcknowledge: vi.fn() }));
vi.mock('../reviewTransitions', () => transitions);

const notifications = vi.hoisted(() => ({ sendResolutionNotification: vi.fn() }));
vi.mock('../incidentNotifications', () => ({ sendResolutionNotification: notifications.sendResolutionNotification }));

import { IncidentAccessDeniedError, IncidentNotFoundError, bulkAcknowledgeIncidents, getIncidentDetailForViewer, listIncidentsForViewer, transitionIncident } from '../reviewService';
import type { IncidentTransitionRequest } from '../types';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const viewer = { userId: USER, staffId: STAFF, role: 'manager' };
const unrestrictedScope = { unrestricted: true, pmUserId: USER, pmStaffId: STAFF };

beforeEach(() => { vi.clearAllMocks(); notifications.sendResolutionNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 }); });

describe('listIncidentsForViewer', () => {
  it('denies without a resolvable scope', async () => {
    scope.resolveIncidentScope.mockResolvedValue(null);
    await expect(listIncidentsForViewer({ limit: 25, offset: 0 }, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);
    expect(queries.listIncidents).not.toHaveBeenCalled();
  });

  it('lists through the resolved scope', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.listIncidents.mockResolvedValue({ incidents: [], total: 0 });
    await listIncidentsForViewer({ limit: 25, offset: 0 }, viewer);
    expect(queries.listIncidents).toHaveBeenCalledWith({ limit: 25, offset: 0 }, unrestrictedScope);
  });
});

describe('getIncidentDetailForViewer', () => {
  it('raises not found for a missing incident', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue(null);
    await expect(getIncidentDetailForViewer(INCIDENT, viewer)).rejects.toBeInstanceOf(IncidentNotFoundError);
  });

  it('denies a restricted scope that does not own the incident project', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: 'project-a' });
    scope.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getIncidentDetailForViewer(INCIDENT, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);
  });

  /**
   * A driver's submitted explanation is read from `getIncidentActions` (its `note` column —
   * see `submissionService.ts` and `reviewQueries.ts#getIncidentActions`) exactly like any
   * other action; there is no separate driver-response read path. So proving a PM cannot
   * read another PM's incident's driver response *is* proving `getIncidentActions` is never
   * reached once the project-ownership check denies access — this is that proof, not a
   * restatement of the generic "denies a restricted scope" test above.
   */
  it('never reaches a driver\'s submitted explanation when a PM is scoped to a different project — access is denied before any action/evidence read', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: 'another-pms-project' });
    scope.isProjectOwnedByScope.mockResolvedValue(false);

    await expect(getIncidentDetailForViewer(INCIDENT, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);

    expect(scope.isProjectOwnedByScope).toHaveBeenCalledWith({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF }, 'another-pms-project');
    expect(queries.getIncidentActions).not.toHaveBeenCalled();
    expect(queries.getIncidentEvidence).not.toHaveBeenCalled();
  });

  it('proves the negative case too: an authorized PM whose scope owns the project DOES receive the driver\'s submitted explanation, verbatim, via the action timeline', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: 'this-pms-project' });
    scope.isProjectOwnedByScope.mockResolvedValue(true);
    queries.getIncidentActions.mockResolvedValue([{
      id: 'a1', actionType: 'driver_response_received', note: 'I was on site at the time', visibility: 'driver_submitted',
    }]);
    queries.getIncidentEvidence.mockResolvedValue([]);
    queries.getIncidentDeliverySummary.mockResolvedValue({ delivered: 0, suppressed: 0, failed: 0 });

    const detail = await getIncidentDetailForViewer(INCIDENT, viewer);

    expect(detail.actions).toEqual([expect.objectContaining({ note: 'I was on site at the time', visibility: 'driver_submitted' })]);
  });

  it('composes core, actions, evidence, and delivery for an authorized viewer', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null });
    queries.getIncidentActions.mockResolvedValue([{ id: 'a1' }]);
    queries.getIncidentEvidence.mockResolvedValue([{ id: 'e1' }]);
    queries.getIncidentDeliverySummary.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
    const detail = await getIncidentDetailForViewer(INCIDENT, viewer);
    expect(detail).toMatchObject({ id: INCIDENT, actions: [{ id: 'a1' }], evidence: [{ id: 'e1' }], delivery: { delivered: 1 } });
  });
});

describe('transitionIncident', () => {
  const request: IncidentTransitionRequest = { incidentId: INCIDENT, actionType: 'acknowledged', actorUserId: USER, note: null };

  it('denies without edit scope and never calls the transition runner', async () => {
    scope.resolveIncidentScope.mockResolvedValue(null);
    await expect(transitionIncident(request, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);
    expect(transitions.runIncidentTransition).not.toHaveBeenCalled();
  });

  it('denies a restricted scope that does not own the incident project before mutating', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: 'project-a' });
    scope.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(transitionIncident(request, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);
    expect(transitions.runIncidentTransition).not.toHaveBeenCalled();
  });

  it('sends the resolution notification only after the transaction has committed', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null });
    const notifyPayload = { incidentId: INCIDENT, incidentReference: 'INC-LATE-20260813-ABC123', incidentType: 'late', severity: 'high', projectId: null, staffName: 'Jane', lifecycleStatus: 'resolved', outcome: 'confirmed', resolutionNote: 'ok' };
    transitions.runIncidentTransition.mockResolvedValue({ result: { incidentId: INCIDENT, lifecycleStatus: 'resolved', actionId: 'action-1' }, notify: notifyPayload });
    const callOrder: string[] = [];
    transitions.runIncidentTransition.mockImplementation(async () => { callOrder.push('transition'); return { result: { incidentId: INCIDENT, lifecycleStatus: 'resolved', actionId: 'action-1' }, notify: notifyPayload }; });
    notifications.sendResolutionNotification.mockImplementation(async () => { callOrder.push('notify'); return { delivered: 1, suppressed: 0, failed: 0 }; });
    const result = await transitionIncident({ ...request, actionType: 'resolved', outcome: 'confirmed', note: 'ok' }, viewer);
    expect(result).toEqual({ incidentId: INCIDENT, lifecycleStatus: 'resolved', actionId: 'action-1' });
    expect(callOrder).toEqual(['transition', 'notify']);
    expect(notifications.sendResolutionNotification).toHaveBeenCalledWith(notifyPayload);
  });

  it('does not notify for non-terminal transitions', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null });
    transitions.runIncidentTransition.mockResolvedValue({ result: { incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a1' } });
    await transitionIncident(request, viewer);
    expect(notifications.sendResolutionNotification).not.toHaveBeenCalled();
  });
});

describe('bulkAcknowledgeIncidents', () => {
  it('denies without edit scope', async () => {
    scope.resolveIncidentScope.mockResolvedValue(null);
    await expect(bulkAcknowledgeIncidents([INCIDENT], viewer, null)).rejects.toBeInstanceOf(IncidentAccessDeniedError);
    expect(transitions.runBulkAcknowledge).not.toHaveBeenCalled();
  });

  it('delegates to runBulkAcknowledge with the resolved scope', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    transitions.runBulkAcknowledge.mockResolvedValue({ results: [] });
    await bulkAcknowledgeIncidents([INCIDENT], viewer, 'req-1');
    expect(transitions.runBulkAcknowledge).toHaveBeenCalledWith([INCIDENT], USER, unrestrictedScope, 'req-1');
  });
});
