import { beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => ({
  expandActiveTeamStaff: vi.fn(), loadPreviewState: vi.fn(), runAssignmentTransaction: vi.fn(),
  insertAssignment: vi.fn(), insertAudit: vi.fn(), lockAssignment: vi.fn(), supersedeAssignment: vi.fn(),
  endAssignmentRow: vi.fn(), listAssignmentHistory: vi.fn(), loadAssignmentsForCopy: vi.fn(), lockRelevantPreviewSources: vi.fn(),
}));
vi.mock('../assignmentQueries', () => q);

import {
  AssignmentServiceError, commitAssignments, endAssignment, getAssignmentHistory,
  previewAssignmentCopy, previewAssignments, replaceAssignment,
} from '../bulkAssignmentService';

const STAFF = '11111111-1111-4111-8111-111111111111';
const STAFF_2 = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';
const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
const VEHICLE = '66666666-6666-4666-8666-666666666666';
const TEAM = '77777777-7777-4777-8777-777777777777';
const ACTOR = { userId: '88888888-8888-4888-8888-888888888888', role: 'admin' };
const row = (staffId = STAFF) => ({ staffId, projectId: PROJECT, operationalSiteId: SITE,
  startDate: '2026-08-17', endDate: '2026-08-21', assignmentKind: 'roster' as const,
  vehicleAssignmentId: null, reason: null });
const state = (rows = [row()], warnings = false) => ({
  context: { staffById: Object.fromEntries(rows.map((r) => [r.staffId, { isActive: true }])),
    projectsById: { [PROJECT]: { isActive: true } }, operationalSitesById: { [SITE]: { isActive: true, projectId: PROJECT } },
    existingAssignments: [], vehicleAssignments: [], vehicleProjectAssignments: [], unscheduledDatesByStaffId: warnings ? { [STAFF]: ['2026-08-18'] } : {} },
  sourceVersion: 'v1', snapshots: { [PROJECT]: { projectName: 'Lawley', projectCode: 'LAW', sites: { [SITE]: 'Depot' } } },
});

beforeEach(() => {
  vi.clearAllMocks(); q.expandActiveTeamStaff.mockResolvedValue({ staffIds: [STAFF, STAFF_2], excludedStaffIds: ['inactive'] });
  q.loadPreviewState.mockResolvedValue(state());
  q.runAssignmentTransaction.mockImplementation(async (fn) => fn({}));
  q.insertAssignment.mockImplementation(async (_tx, proposal) => ({ id: proposal.staffId, ...proposal, status: 'active' }));
  q.lockAssignment.mockResolvedValue({ id: ASSIGNMENT, ...row(), status: 'active' });
});

describe('bulk assignment service', () => {
  it('expands teams to active internal staff and reports inactive exclusions', async () => {
    q.loadPreviewState.mockResolvedValue(state([row(), row(STAFF_2)]));
    const result = await previewAssignments({ rows: [], teamIds: [TEAM], teamRow: { ...row(), staffId: undefined } }, { allProjects: true });
    expect(result.normalizedRows.map((item) => item.staffId)).toEqual([STAFF, STAFF_2]);
    expect(result.excludedStaffIds).toEqual(['inactive']);
  });

  it('rejects stale previews and requires explicit warning confirmation', async () => {
    const preview = await previewAssignments({ rows: [row()] }, { allProjects: true });
    q.loadPreviewState.mockResolvedValue({ ...state([row()], true), sourceVersion: 'v2' });
    await expect(commitAssignments({ rows: [row()], confirmedWarnings: true }, preview.fingerprint, ACTOR)).rejects.toMatchObject({ code: 'STALE_PREVIEW', status: 409 });
    const warned = await previewAssignments({ rows: [row()] }, { allProjects: true });
    await expect(commitAssignments({ rows: [row()] }, warned.fingerprint, ACTOR)).rejects.toMatchObject({ code: 'WARNINGS_UNCONFIRMED', status: 409 });
  });

  it('writes all assignments and one audit per staff under a shared batch id', async () => {
    const rows = [row(), row(STAFF_2)]; q.loadPreviewState.mockResolvedValue(state(rows));
    const preview = await previewAssignments({ rows }, { allProjects: true });
    const result = await commitAssignments({ rows }, preview.fingerprint, ACTOR);
    expect(result.assignmentIds).toEqual([STAFF, STAFF_2]);
    expect(q.insertAudit).toHaveBeenCalledTimes(2);
    expect(q.insertAudit.mock.calls[0][3]).toBe(result.batchId);
    expect(q.insertAudit.mock.calls[1][3]).toBe(result.batchId);
    expect(q.lockRelevantPreviewSources).toHaveBeenCalledWith({}, rows, undefined);
    expect(q.lockRelevantPreviewSources.mock.invocationCallOrder[0]).toBeLessThan(q.loadPreviewState.mock.invocationCallOrder.at(-1)!);
  });

  it('lets the transaction roll back all work when a later insert fails', async () => {
    const rows = [row(), row(STAFF_2)]; q.loadPreviewState.mockResolvedValue(state(rows));
    const preview = await previewAssignments({ rows }, { allProjects: true });
    const persisted: string[] = [];
    q.runAssignmentTransaction.mockImplementationOnce(async (fn) => {
      const staged: string[] = [];
      try { const result = await fn({ staged }); persisted.push(...staged); return result; }
      catch (error) { staged.length = 0; throw error; }
    });
    q.insertAssignment.mockImplementationOnce(async (tx) => { tx.staged.push(STAFF); return { id: STAFF, ...row(), status: 'active' }; })
      .mockRejectedValueOnce(new Error('write failed'));
    await expect(commitAssignments({ rows }, preview.fingerprint, ACTOR)).rejects.toThrow('write failed');
    expect(persisted).toEqual([]);
  });

  it('maps PostgreSQL exclusion conflicts to a 409 service error', async () => {
    const preview = await previewAssignments({ rows: [row()] }, { allProjects: true });
    q.insertAssignment.mockRejectedValue(Object.assign(new Error('overlap'), { code: '23P01' }));
    await expect(commitAssignments({ rows: [row()] }, preview.fingerprint, ACTOR)).rejects.toMatchObject({ code: 'ASSIGNMENT_OVERLAP', status: 409 });
  });

  it('replaces by inserting then superseding, linked by one correlation id', async () => {
    q.loadPreviewState.mockResolvedValue(state([row(STAFF_2)]));
    const created = await replaceAssignment(ASSIGNMENT, row(STAFF_2), ACTOR);
    expect(created.id).toBe(STAFF_2);
    expect(q.supersedeAssignment).toHaveBeenCalledWith({}, ASSIGNMENT, STAFF_2);
    expect(q.insertAudit.mock.calls.at(-1)?.[3]).toBe(q.insertAudit.mock.calls.at(-2)?.[3]);
  });

  it('ends without deleting, validates the date, and returns newest-first history', async () => {
    await expect(endAssignment(ASSIGNMENT, { endDate: '2026-08-16', reason: 'Early' }, ACTOR)).rejects.toMatchObject({ code: 'INVALID_END_DATE' });
    await endAssignment(ASSIGNMENT, { endDate: '2026-08-19', reason: 'Moved' }, ACTOR);
    expect(q.endAssignmentRow).toHaveBeenCalled();
    q.listAssignmentHistory.mockResolvedValue([{ occurredAt: '2026-08-20' }, { occurredAt: '2026-08-19' }]);
    expect(await getAssignmentHistory(ASSIGNMENT)).toEqual([{ occurredAt: '2026-08-20' }, { occurredAt: '2026-08-19' }]);
  });

  it('copies rosters only and re-resolves the destination-date vehicle', async () => {
    q.loadAssignmentsForCopy.mockResolvedValue([{ ...row(), id: ASSIGNMENT }, { ...row(), id: 'override', assignmentKind: 'daily_override' }]);
    q.loadPreviewState.mockResolvedValue({ ...state(), context: { ...state().context,
      vehicleAssignments: [{ id: VEHICLE, staffId: STAFF, vehicleId: 'truck', startDate: '2026-09-01', endDate: '2026-09-05' }] } });
    const result = await previewAssignmentCopy({ assignmentIds: [ASSIGNMENT, 'override'], destinationStartDate: '2026-09-01' }, { allProjects: true });
    expect(result.normalizedRows).toHaveLength(1);
    expect(result.normalizedRows[0]?.vehicleAssignmentId).toBe(VEHICLE);
  });
});

describe('AssignmentServiceError', () => {
  it('preserves code and status', () => expect(new AssignmentServiceError('STALE_PREVIEW', 'stale', 409)).toMatchObject({ code: 'STALE_PREVIEW', status: 409 }));
});

describe('assignment source locking', () => {
  it('locks every mutable validation and fingerprint dependency before writes', async () => {
    const actual = await vi.importActual<typeof import('../assignmentQueries')>('../assignmentQueries');
    const statements: string[] = [];
    const tx = { query: async (sql: string) => { statements.push(sql.replace(/\s+/g, ' ')); return []; }, queryOne: async () => null };

    await actual.lockRelevantPreviewSources(tx, [row()], [TEAM]);

    expect(statements.join('\n')).toMatch(/FROM staff .*FOR UPDATE/);
    expect(statements.join('\n')).toMatch(/FROM projects .*FOR UPDATE/);
    expect(statements.join('\n')).toMatch(/fleet_project_operational_sites .*FOR UPDATE/);
    expect(statements.join('\n')).toMatch(/vehicle_assignments .*FOR UPDATE/);
    expect(statements.join('\n')).toMatch(/fleet_vehicle_project_assignments .*FOR UPDATE OF fvpa/);
    expect(statements.join('\n')).toMatch(/FROM teams .*FOR UPDATE/);
    expect(statements.join('\n')).toMatch(/FROM team_members .*FOR UPDATE/);
    expect(statements.join('\n')).toMatch(/attendance_policy_assignments .*FOR UPDATE/);
  });
});
