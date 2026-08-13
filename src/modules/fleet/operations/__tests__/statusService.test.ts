import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), evaluate: vi.fn() }));
vi.mock('../evidenceQueries', () => ({ loadOperationalEvidence: mocks.load }));
vi.mock('../evaluateStatus', () => ({ evaluateOperationalStatus: mocks.evaluate }));
import { getOperationalEvidenceDetail, getOperationalRosterStatus, OperationalStatusRequestError } from '../statusService';

const point = { latitude: -26.1, longitude: 28.1, recordedAt: '2026-08-14T08:00:00Z' };
const evidence = { asOf: '2026-08-14T12:00:00Z', workDate: '2026-08-14', staffId: 'staff-1', staffName: 'Driver', assignment: { assignmentId: 'a', source: 'roster', projectId: 'p', operationalSiteId: 's', ambiguous: false, siteGeometryValid: true, siteGeometryLowConfidence: false }, schedule: { policyId: 'policy', workDate: '2026-08-14', timezone: 'Africa/Johannesburg', scheduled: true, explicitWork: false, startTime: '08:00', endTime: '17:00', graceMinutes: 15 }, attendance: { entryId: 'e', clockInAt: point.recordedAt, clockOutAt: null, clockInPoint: point, clockOutPoint: null, matchedSiteId: 's', requiredSite: { valid: true, inside: true, distanceM: 0, knownSiteId: 's' } }, vehicle: { assignmentId: null, vehicleId: null, provider: null, accountRef: null, staleAfterSeconds: null, positions: [] }, rule: { id: 'r', version: 1 }, sourceWarnings: [], sourceErrors: [] };
const evaluation = { status: 'attendance_confirmed', flags: [], reasonCodes: ['inside'], ruleId: 'r', ruleVersion: 1, sourceTimestamps: [point.recordedAt], thresholdsUsed: {} };

beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue([evidence]); mocks.evaluate.mockReturnValue(evaluation); });

describe('status service validation and privacy', () => {
  it.each([
    { projectId: 'p', workDate: 'bad', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-02-30', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: 'bad', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: '2026-02-30T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-01-01', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 0, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 101 },
  ])('rejects invalid or out-of-bounds request %#', async (request) => {
    await expect(getOperationalRosterStatus(request)).rejects.toBeInstanceOf(OperationalStatusRequestError);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('returns coordinate-free summaries and isolates one malformed evaluation', async () => {
    mocks.load.mockResolvedValue([evidence, { ...evidence, staffId: 'staff-2' }]);
    mocks.evaluate.mockReturnValueOnce(evaluation).mockImplementationOnce(() => { throw new Error('bad person'); });
    const result = await getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 });
    expect(result.items).toHaveLength(2); expect(JSON.stringify(result)).not.toContain('latitude');
    expect(result.items[1]).toMatchObject({ status: 'unverifiable', flags: ['evidence_source_error'] });
  });

  it('returns only minimum decision points in protected detail', async () => {
    const detail = await getOperationalEvidenceDetail({ projectId: 'p', staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z' });
    expect(detail.points).toEqual([{ source: 'attendance_clock_in', ...point }]);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', staffId: 'staff-1' }));
    expect(JSON.stringify(detail)).not.toContain('clockInPoint');
    expect(JSON.stringify(detail)).not.toContain('positions');
    expect(detail).not.toHaveProperty('evidence');
  });

  it.each([undefined, '', '00000000-0000-0000-0000-000000000000'])('rejects missing or zero detail projectId %#', async (projectId) => {
    await expect(getOperationalEvidenceDetail({ projectId, staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z' } as Parameters<typeof getOperationalEvidenceDetail>[0])).rejects.toBeInstanceOf(OperationalStatusRequestError);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('propagates a top-level load failure', async () => {
    mocks.load.mockRejectedValue(new Error('database unavailable'));
    await expect(getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 })).rejects.toThrow('database unavailable');
  });
});
