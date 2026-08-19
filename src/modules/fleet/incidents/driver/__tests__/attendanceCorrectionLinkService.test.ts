import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

const driverInputRepo = vi.hoisted(() => ({ findCurrentInputRequest: vi.fn(), poolExecutor: {} }));
vi.mock('../driverInputRepository', () => driverInputRepo);

const incidentService = vi.hoisted(() => ({ computeResponseEligibility: vi.fn() }));
vi.mock('../driverIncidentService', () => incidentService);

const settingsRepo = vi.hoisted(() => ({ getEffectiveDriverInputSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsRepo);

import { CORRECTION_ELIGIBILITY_SQL } from '@/modules/attendance/workflow/correctionEligibility';
import { IncidentNotFoundError } from '../../incidentRepository';
import {
  AttendanceCorrectionLinkValidationError,
  AttendanceCorrectionNotFoundError,
  getAttendanceCorrectionEligibility,
  linkAttendanceCorrection,
} from '../attendanceCorrectionLinkService';

const STAFF = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF = '99999999-9999-4999-8999-999999999999';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const EXCEPTION = '33333333-3333-4333-8333-333333333333';
const ENTRY = '44444444-4444-4444-8444-444444444444';
const CORRECTION = '55555555-5555-4555-8555-555555555555';
const SUBMISSION = '66666666-6666-4666-8666-666666666666';
const WORK_DATE = '2026-08-10';

const settingsRow = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  responseWindowWorkdays: 2, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
  recentWindowDays: 90, historyWindowDays: 365,
  enabledConcernCategories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg'], evidenceMaxBytes: 15728640,
  driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
};

function ownedIncidentRow(overrides: Record<string, unknown> = {}) {
  return { work_date: WORK_DATE, resolved_at: null, ...overrides };
}

function exceptionRow(overrides: Record<string, unknown> = {}) {
  return { exception_id: EXCEPTION, entry_id: ENTRY, ...overrides };
}

/** Wires the queryOne mock to answer, in call order: incident lookup, exception lookup, period-lock check. Extra calls (e.g. findCurrentInputRequest is mocked separately) are unaffected. */
function wireEligibilityHappyPath() {
  db.queryOne
    .mockResolvedValueOnce(ownedIncidentRow())
    .mockResolvedValueOnce(exceptionRow())
    .mockResolvedValueOnce({ locked: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue(settingsRow);
  driverInputRepo.findCurrentInputRequest.mockResolvedValue(null);
  incidentService.computeResponseEligibility.mockReturnValue({ eligible: true, reason: null });
  db.query.mockResolvedValue([]);
  db.queryOne.mockResolvedValue(null);
});

describe('getAttendanceCorrectionEligibility', () => {
  it('rejects an incidentId that is not a valid UUID before touching the database', async () => {
    await expect(getAttendanceCorrectionEligibility('not-a-uuid', STAFF))
      .rejects.toBeInstanceOf(AttendanceCorrectionLinkValidationError);
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it('is IDOR-safe: an incident owned by another driver produces the same not-found error as a missing incident', async () => {
    db.queryOne.mockResolvedValueOnce(null); // scoped incident lookup finds no row for this staff id
    await expect(getAttendanceCorrectionEligibility(INCIDENT, OTHER_STAFF)).rejects.toBeInstanceOf(IncidentNotFoundError);

    const [sql, params] = db.queryOne.mock.calls[0]!;
    expect(sql).toMatch(/staff_id = \$2::uuid/);
    expect(params).toEqual([INCIDENT, OTHER_STAFF]);
  });

  it('reports no_required_exception when no open missing_clock_out exception matches the incident work date', async () => {
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(null); // exception lookup

    await expect(getAttendanceCorrectionEligibility(INCIDENT, STAFF)).resolves.toEqual({
      eligible: false, reason: 'no_required_exception',
    });
  });

  it('reports no_required_exception when the incident has no work_date at all, without querying Attendance for one', async () => {
    db.queryOne.mockResolvedValueOnce(ownedIncidentRow({ work_date: null }));

    await expect(getAttendanceCorrectionEligibility(INCIDENT, STAFF)).resolves.toEqual({
      eligible: false, reason: 'no_required_exception',
    });
    expect(db.queryOne).toHaveBeenCalledTimes(1);
  });

  it('queries Attendance using the real shared eligibility predicate, not a duplicated copy of it', async () => {
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(null);

    await getAttendanceCorrectionEligibility(INCIDENT, STAFF);

    const [sql, params] = db.queryOne.mock.calls[1]!;
    expect(sql).toContain(CORRECTION_ELIGIBILITY_SQL);
    expect(sql).toMatch(/AND de\.work_date = \$2::date/);
    expect(params).toEqual([STAFF, WORK_DATE]);
  });

  it('reports period_locked when the exception exists but its payroll week is frozen', async () => {
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(exceptionRow())
      .mockResolvedValueOnce({ locked: true });

    await expect(getAttendanceCorrectionEligibility(INCIDENT, STAFF)).resolves.toEqual({
      eligible: false, reason: 'period_locked',
    });
  });

  it('reports outside_response_window when the driver-input response window has closed', async () => {
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(exceptionRow())
      .mockResolvedValueOnce({ locked: false });
    incidentService.computeResponseEligibility.mockReturnValue({ eligible: false, reason: 'expired' });

    await expect(getAttendanceCorrectionEligibility(INCIDENT, STAFF)).resolves.toEqual({
      eligible: false, reason: 'outside_response_window',
    });
  });

  it('is eligible with the matched exception/entry ids when every check passes', async () => {
    wireEligibilityHappyPath();

    await expect(getAttendanceCorrectionEligibility(INCIDENT, STAFF)).resolves.toEqual({
      eligible: true, exceptionId: EXCEPTION, entryId: ENTRY,
    });
  });

  it('never writes a generic attendance_adjustments row while checking eligibility', async () => {
    wireEligibilityHappyPath();
    await getAttendanceCorrectionEligibility(INCIDENT, STAFF);

    const allSql = [...db.query.mock.calls, ...db.queryOne.mock.calls].map((call) => String(call[0]));
    expect(allSql.some((sql) => /INSERT INTO attendance_adjustments/i.test(sql))).toBe(false);
  });
});

function correctionRow(overrides: Record<string, unknown> = {}) {
  return { id: CORRECTION, status: 'pending', ...overrides };
}

function wireLinkHappyPath(options: { correction?: Record<string, unknown>; linkId?: string } = {}) {
  db.queryOne
    .mockResolvedValueOnce(ownedIncidentRow()) // incident lookup
    .mockResolvedValueOnce(correctionRow(options.correction)) // correction ownership lookup
    .mockResolvedValueOnce({ id: options.linkId ?? 'link-1' }); // INSERT ... RETURNING id
}

describe('linkAttendanceCorrection', () => {
  it('rejects an incidentId that is not a valid UUID before touching the database', async () => {
    await expect(linkAttendanceCorrection({ incidentId: 'nope', attendanceCorrectionId: CORRECTION }, STAFF))
      .rejects.toBeInstanceOf(AttendanceCorrectionLinkValidationError);
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it('rejects an attendanceCorrectionId that is not a valid UUID before touching the database', async () => {
    await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: 'nope' }, STAFF))
      .rejects.toBeInstanceOf(AttendanceCorrectionLinkValidationError);
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it('is IDOR-safe: an incident owned by another driver produces IncidentNotFoundError, and the link is never inserted', async () => {
    db.queryOne.mockResolvedValueOnce(null);

    await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, OTHER_STAFF))
      .rejects.toBeInstanceOf(IncidentNotFoundError);
    expect(db.queryOne).toHaveBeenCalledTimes(1);
  });

  it('a driver cannot link another staff member\'s attendance correction even when the request names it explicitly', async () => {
    // The incident is genuinely this driver's own, but the named attendanceCorrectionId belongs
    // to someone else — the scoped ownership query (requested_by/e.staff_id = the session driver)
    // finds no matching row for it, exactly as it would for a correction that does not exist.
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(null);

    await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, STAFF))
      .rejects.toBeInstanceOf(AttendanceCorrectionNotFoundError);

    const [sql, params] = db.queryOne.mock.calls[1]!;
    expect(sql).toMatch(/a\.requested_by = \$2::uuid/);
    expect(sql).toMatch(/e\.staff_id = \$2::uuid/);
    expect(params).toEqual([CORRECTION, STAFF, WORK_DATE]);
  });

  it('rejects a correction whose entry work_date does not match the incident work_date, even for the owning driver', async () => {
    // Simulated by the same scoped query returning null: the real SQL's `e.work_date = $3::date`
    // predicate is what excludes it, proven by the assertion above on the query text/params.
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(null);

    await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, STAFF))
      .rejects.toBeInstanceOf(AttendanceCorrectionNotFoundError);
  });

  it('rejects a driverSubmissionId that does not belong to the incident/driver, without inserting a link', async () => {
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(null); // submission ownership lookup

    await expect(linkAttendanceCorrection(
      { incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, driverSubmissionId: SUBMISSION }, STAFF,
    )).rejects.toBeInstanceOf(AttendanceCorrectionLinkValidationError);
    expect(db.queryOne).toHaveBeenCalledTimes(2);
  });

  it('links a valid, owned, work-date-matched correction and returns its live Attendance state', async () => {
    wireLinkHappyPath();

    await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, STAFF))
      .resolves.toEqual({ linkId: 'link-1', incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, correctionState: 'pending' });
  });

  it('returns the existing link instead of erroring on a duplicate link attempt', async () => {
    db.queryOne
      .mockResolvedValueOnce(ownedIncidentRow())
      .mockResolvedValueOnce(correctionRow())
      .mockResolvedValueOnce(null) // INSERT ... ON CONFLICT DO NOTHING returns no row
      .mockResolvedValueOnce({ id: 'existing-link' }); // fallback SELECT of the pre-existing row

    await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, STAFF))
      .resolves.toMatchObject({ linkId: 'existing-link' });
  });

  it.each(['pending', 'approved', 'rejected', 'cancelled'] as const)(
    'surfaces a live Attendance status of "%s" as the link result correctionState',
    async (status) => {
      wireLinkHappyPath({ correction: { status } });

      await expect(linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, STAFF))
        .resolves.toMatchObject({ correctionState: status });
    },
  );

  it('never writes a generic attendance_adjustments row while linking a correction', async () => {
    wireLinkHappyPath();
    await linkAttendanceCorrection({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION }, STAFF);

    const allSql = [...db.query.mock.calls, ...db.queryOne.mock.calls].map((call) => String(call[0]));
    expect(allSql.some((sql) => /INSERT INTO attendance_adjustments/i.test(sql))).toBe(false);
    expect(allSql.some((sql) => /UPDATE attendance_adjustments/i.test(sql))).toBe(false);
  });
});
