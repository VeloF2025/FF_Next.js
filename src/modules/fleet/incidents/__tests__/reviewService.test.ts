import { beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn() }));
vi.mock('../reviewScope', () => ({ resolveIncidentScope: scope.resolveIncidentScope, isProjectOwnedByScope: scope.isProjectOwnedByScope }));

const queries = vi.hoisted(() => ({
  listIncidents: vi.fn(), getIncidentCore: vi.fn(), getIncidentActions: vi.fn(),
  getIncidentEvidence: vi.fn(), getIncidentDeliverySummary: vi.fn(),
  getIncidentDriverInputSummary: vi.fn(), getIncidentCorrectionLinks: vi.fn(),
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

const NOT_REQUESTED_DRIVER_INPUT = { state: 'not_requested' as const, respondBy: null, deliveryFailed: false };

beforeEach(() => {
  vi.clearAllMocks();
  notifications.sendResolutionNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
  queries.getIncidentDriverInputSummary.mockResolvedValue(NOT_REQUESTED_DRIVER_INPUT);
  queries.getIncidentCorrectionLinks.mockResolvedValue([]);
});

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

  /**
   * PR7 review C1/I2/I3: `driverInput` and `correctionLinks` were entirely absent from the
   * manager-facing detail before this fix. Proves both are composed into the returned detail,
   * and — reusing the exact same project-scope gate proven above for actions/evidence —
   * that neither read is reached once that gate denies access (C1: "reuse the existing
   * enforcement ... rather than adding a second scope check").
   */
  it('composes driverInput and correctionLinks for an authorized viewer, behind the same project-scope gate as everything else', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null, resolvedAt: null });
    queries.getIncidentDriverInputSummary.mockResolvedValue({ state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false });
    queries.getIncidentCorrectionLinks.mockResolvedValue([{ id: 'link-1', attendanceCorrectionId: 'adj-1', linkedAt: '2026-08-18T09:00:00.000Z', correctionState: 'pending' }]);

    const detail = await getIncidentDetailForViewer(INCIDENT, viewer);

    expect(detail.driverInput).toEqual({ state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false });
    expect(detail.correctionLinks).toEqual([{ id: 'link-1', attendanceCorrectionId: 'adj-1', linkedAt: '2026-08-18T09:00:00.000Z', correctionState: 'pending' }]);
    expect(queries.getIncidentDriverInputSummary).toHaveBeenCalledWith(INCIDENT, null, expect.any(String));
  });

  it('never reaches driverInput/correctionLinks either, once project scope denies access', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: 'another-pms-project' });
    scope.isProjectOwnedByScope.mockResolvedValue(false);

    await expect(getIncidentDetailForViewer(INCIDENT, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);

    expect(queries.getIncidentDriverInputSummary).not.toHaveBeenCalled();
    expect(queries.getIncidentCorrectionLinks).not.toHaveBeenCalled();
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

  /**
   * The scope chain only ever asked "is this incident in a project you manage?". A
   * supervisor who manages a project AND is on the operational roster satisfies that for an
   * incident about their own conduct, so without this guard they can acknowledge ->
   * review_started -> dismissed it themselves. Every action type is covered because the
   * chain is only as strong as its weakest link: acknowledging your own incident is the
   * step that unlocks the rest.
   */
  const SELF_ACTIONS: IncidentTransitionRequest['actionType'][] = ['acknowledged', 'review_started', 'commented', 'resolved', 'dismissed'];
  it.each(SELF_ACTIONS)('refuses %s when the acting manager is the subject of the incident, before mutating', async (actionType) => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
    scope.isProjectOwnedByScope.mockResolvedValue(true);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: 'this-pms-project', staffId: STAFF });

    await expect(transitionIncident({ ...request, actionType, outcome: 'confirmed' }, viewer))
      .rejects.toBeInstanceOf(IncidentAccessDeniedError);
    expect(transitions.runIncidentTransition).not.toHaveBeenCalled();
  });

  it('refuses an oversight member acting on their own incident too', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null, staffId: STAFF });

    await expect(transitionIncident(request, viewer)).rejects.toBeInstanceOf(IncidentAccessDeniedError);
    expect(transitions.runIncidentTransition).not.toHaveBeenCalled();
  });

  it('says plainly why the action was refused', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null, staffId: STAFF });

    await expect(transitionIncident(request, viewer)).rejects.toThrow(/about you/i);
  });

  // The negative case: the guard must not block ordinary review of someone else's incident,
  // nor a manager who has no staff record at all (matching null-to-null would lock every
  // non-staff manager out of the entire queue).
  it('still lets a manager act on an incident about someone else', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null, staffId: 'a-different-staff-id' });
    transitions.runIncidentTransition.mockResolvedValue({ result: { incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a1' } });

    await expect(transitionIncident(request, viewer)).resolves.toMatchObject({ actionId: 'a1' });
  });

  it('still lets a manager with no staff record act on an unassigned incident', async () => {
    scope.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: USER, pmStaffId: null });
    queries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: null, staffId: null });
    transitions.runIncidentTransition.mockResolvedValue({ result: { incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a1' } });

    await expect(transitionIncident(request, { userId: USER, staffId: null, role: 'manager' }))
      .resolves.toMatchObject({ actionId: 'a1' });
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

  it('passes the viewer staff id through so runBulkAcknowledge can refuse self-owned ids', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    transitions.runBulkAcknowledge.mockResolvedValue({ results: [], conflicts: [] });

    await bulkAcknowledgeIncidents([INCIDENT], viewer, 'req-1');

    expect(transitions.runBulkAcknowledge).toHaveBeenCalledWith([INCIDENT], USER, expect.objectContaining({ pmStaffId: STAFF }), 'req-1');
  });

  it('delegates to runBulkAcknowledge with the resolved scope', async () => {
    scope.resolveIncidentScope.mockResolvedValue(unrestrictedScope);
    transitions.runBulkAcknowledge.mockResolvedValue({ results: [] });
    await bulkAcknowledgeIncidents([INCIDENT], viewer, 'req-1');
    expect(transitions.runBulkAcknowledge).toHaveBeenCalledWith([INCIDENT], USER, unrestrictedScope, 'req-1');
  });
});
