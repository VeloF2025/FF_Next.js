import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxnClient } from '@/lib/db-pool';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

import {
  findCurrentInputRequest,
  findDriverIncidentDetail,
  findDriverIncidents,
  lockIncidentForDriver,
  listVisibleTimeline,
  poolExecutor,
} from '../driverInputRepository';
import {
  DuplicateCorrectionLinkError,
  insertAttendanceCorrectionLink,
  insertDriverSubmission,
  insertInputRequest,
} from '../driverInputWriteRepository';

const STAFF = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF = '99999999-9999-4999-8999-999999999999';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

function fakeTxn(): TxnClient & { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  const queryOne = vi.fn();
  return { query, queryOne, client: {} as never } as unknown as TxnClient & { query: typeof query; queryOne: typeof queryOne };
}

beforeEach(() => { vi.clearAllMocks(); });

const requestRow = {
  id: REQUEST_ID, incident_id: INCIDENT, guidance: 'Please explain the late start', requested_at: '2026-08-10T08:00:00.000Z',
  respond_by: '2026-08-12T21:59:59.999Z', superseded_at: null, closed_at: null, closure_reason: null,
  delivery_attempted_count: 1, delivery_accepted_count: 1, delivery_failed_count: 0,
};

const incidentListRow = {
  id: INCIDENT, incident_reference: 'INC-LATE-20260810-ABC123', incident_type: 'late', severity: 'high',
  lifecycle_status: 'open', project_name_snapshot: 'Corridor A', operational_site_name_snapshot: 'Site 4',
  detected_at: '2026-08-10T08:00:00.000Z', condition_cleared_at: null, resolved_at: null,
  request_id: REQUEST_ID, guidance: 'Please explain the late start', requested_at: '2026-08-10T08:00:00.000Z',
  respond_by: '2026-08-12T21:59:59.999Z', responded_at: null,
};

describe('lockIncidentForDriver', () => {
  it('locks the incident scoped to both id and staff id', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue({ id: INCIDENT, staff_id: STAFF, lifecycle_status: 'open', resolved_at: null });

    const result = await lockIncidentForDriver(STAFF, INCIDENT, txn);

    expect(result).toMatchObject({ id: INCIDENT, staffId: STAFF, lifecycleStatus: 'open', terminalAt: null });
    const [text, params] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('FOR UPDATE');
    expect(text).toMatch(/staff_id = \$2::uuid/);
    expect(params).toEqual([INCIDENT, STAFF]);
  });

  it('returns null when the incident does not belong to this staff member, regardless of the incident id being real', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(null);

    await expect(lockIncidentForDriver(OTHER_STAFF, INCIDENT, txn)).resolves.toBeNull();
    expect(txn.queryOne.mock.calls[0]![1]).toEqual([INCIDENT, OTHER_STAFF]);
  });
});

describe('insertInputRequest', () => {
  it('inserts a new request and reports it as created', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(requestRow);

    const result = await insertInputRequest(
      { incidentId: INCIDENT, requestedBy: USER, guidance: 'Please explain', respondBy: '2026-08-12T21:59:59.999Z', idempotencyKey: 'k1' },
      txn,
    );

    expect(result).toEqual({ created: true, record: expect.objectContaining({ id: REQUEST_ID, incidentId: INCIDENT }) });
    const [text] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('INSERT INTO fleet_incident_driver_input_requests');
    expect(text).toContain('ON CONFLICT (incident_id, idempotency_key) DO NOTHING');
    expect(text).not.toMatch(/\bUPDATE\b/);
    expect(text).not.toMatch(/\bDELETE\b/);
  });

  it('returns the existing row unchanged on a duplicate idempotency key, without a second INSERT', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(requestRow);

    const result = await insertInputRequest(
      { incidentId: INCIDENT, requestedBy: USER, guidance: 'Please explain', respondBy: '2026-08-12T21:59:59.999Z', idempotencyKey: 'k1' },
      txn,
    );

    expect(result.created).toBe(false);
    expect(result.record.id).toBe(REQUEST_ID);
    expect(txn.queryOne).toHaveBeenCalledTimes(2);
    expect(txn.queryOne.mock.calls[1]![0]).toContain('SELECT');
    expect(txn.queryOne.mock.calls[1]![1]).toEqual([INCIDENT, 'k1']);
  });
});

describe('findCurrentInputRequest', () => {
  it('selects only the latest non-superseded request for the incident', async () => {
    db.queryOne.mockResolvedValue(requestRow);

    const result = await findCurrentInputRequest(INCIDENT, poolExecutor);

    expect(result).toMatchObject({ id: REQUEST_ID });
    const [text, params] = db.queryOne.mock.calls[0]!;
    expect(text).toContain('superseded_at IS NULL');
    expect(text).toContain('ORDER BY requested_at DESC');
    expect(params).toEqual([INCIDENT]);
  });

  it('returns null when no open request exists', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(findCurrentInputRequest(INCIDENT, poolExecutor)).resolves.toBeNull();
  });

  it('works against a transactional executor too (used by the requesting flow to supersede)', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(requestRow);

    await expect(findCurrentInputRequest(INCIDENT, txn)).resolves.toMatchObject({ id: REQUEST_ID });
    expect(txn.queryOne).toHaveBeenCalledTimes(1);
    expect(db.queryOne).not.toHaveBeenCalled();
  });
});

describe('insertDriverSubmission', () => {
  const submissionRow = {
    id: '55555555-5555-4555-8555-555555555555', incident_id: INCIDENT, input_request_id: REQUEST_ID, staff_id: STAFF,
    submission_kind: 'response', explanation: 'Traffic delay on site road', concern_category: null,
    idempotency_key: 's1', created_at: '2026-08-10T09:00:00.000Z',
  };

  it('inserts a new submission and reports it as created', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(submissionRow);

    const result = await insertDriverSubmission(
      {
        incidentId: INCIDENT, inputRequestId: REQUEST_ID, staffId: STAFF, submissionKind: 'response',
        explanation: 'Traffic delay on site road', concernCategory: null, idempotencyKey: 's1', clientMetadata: {},
      },
      txn,
    );

    expect(result.created).toBe(true);
    expect(result.record).toMatchObject({ id: submissionRow.id, staffId: STAFF, submissionKind: 'response' });
    const [text] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('INSERT INTO fleet_incident_driver_submissions');
    expect(text).toContain('ON CONFLICT (incident_id, staff_id, idempotency_key) DO NOTHING');
  });

  it('replays the original record on a duplicate idempotency key', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(submissionRow);

    const result = await insertDriverSubmission(
      {
        incidentId: INCIDENT, inputRequestId: REQUEST_ID, staffId: STAFF, submissionKind: 'response',
        explanation: 'Traffic delay on site road', concernCategory: null, idempotencyKey: 's1', clientMetadata: {},
      },
      txn,
    );

    expect(result.created).toBe(false);
    expect(result.record.id).toBe(submissionRow.id);
    expect(txn.queryOne.mock.calls[1]![1]).toEqual([INCIDENT, STAFF, 's1']);
  });
});

describe('insertAttendanceCorrectionLink', () => {
  it('inserts a link row', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666', incident_id: INCIDENT,
      attendance_correction_id: '77777777-7777-4777-8777-777777777777', staff_id: STAFF, linked_at: '2026-08-11T00:00:00.000Z',
    });

    const result = await insertAttendanceCorrectionLink(
      { incidentId: INCIDENT, driverSubmissionId: null, attendanceCorrectionId: '77777777-7777-4777-8777-777777777777', staffId: STAFF, linkedBy: STAFF },
      txn,
    );

    expect(result).toMatchObject({ incidentId: INCIDENT, staffId: STAFF });
    expect(txn.queryOne.mock.calls[0]![0]).toContain('INSERT INTO fleet_incident_attendance_correction_links');
  });

  it('wraps a unique-violation on (incident_id, attendance_correction_id) as a domain error', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    await expect(insertAttendanceCorrectionLink(
      { incidentId: INCIDENT, driverSubmissionId: null, attendanceCorrectionId: '77777777-7777-4777-8777-777777777777', staffId: STAFF, linkedBy: STAFF },
      txn,
    )).rejects.toBeInstanceOf(DuplicateCorrectionLinkError);
  });

  it('rethrows a non-uniqueness error unchanged', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockRejectedValue(new Error('connection reset'));

    await expect(insertAttendanceCorrectionLink(
      { incidentId: INCIDENT, driverSubmissionId: null, attendanceCorrectionId: '77777777-7777-4777-8777-777777777777', staffId: STAFF, linkedBy: STAFF },
      txn,
    )).rejects.toThrow('connection reset');
  });
});

describe('findDriverIncidents', () => {
  const baseParams = {
    terminalWindowDays: 90, recentWindowDays: 90, historyWindowDays: 365,
    postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    limit: 20, offset: 0, now: '2026-08-13T00:00:00.000Z',
  };

  it('scopes strictly to the supplied staff id, always bound to the same fixed placeholder', async () => {
    db.query.mockResolvedValue([incidentListRow]);
    db.queryOne.mockResolvedValue({ count: '1' });

    await findDriverIncidents(STAFF, baseParams);

    const [listText, listParams] = db.query.mock.calls[0]!;
    expect(listText).toMatch(/staff_id = \$1::uuid/);
    expect(listParams[0]).toBe(STAFF);
    const [countText, countParams] = db.queryOne.mock.calls[0]!;
    expect(countText).toMatch(/staff_id = \$1::uuid/);
    expect(countParams[0]).toBe(STAFF);
  });

  it('an attacker-controlled options object cannot override the staff id predicate', async () => {
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue({ count: '0' });

    // Even if a caller stuffs a staffId-shaped property onto params, the function signature
    // has no such field, so there is nothing for it to read: staffId only ever comes from
    // the required first argument.
    await findDriverIncidents(STAFF, { ...baseParams, staffId: OTHER_STAFF } as never);

    expect(db.query.mock.calls[0]![1][0]).toBe(STAFF);
  });

  it('maps a row into a driver-safe list item with derived state', async () => {
    db.query.mockResolvedValue([incidentListRow]);
    db.queryOne.mockResolvedValue({ count: '1' });

    const result = await findDriverIncidents(STAFF, { ...baseParams, now: '2026-08-11T00:00:00.000Z' });

    expect(result.total).toBe(1);
    expect(result.incidents[0]).toMatchObject({
      id: INCIDENT, conditionState: 'active', driverInputState: 'requested',
      currentRequest: { id: REQUEST_ID, guidance: 'Please explain the late start', respondBy: '2026-08-12T21:59:59.999Z' },
    });
    expect(result.incidents[0]!.neutralLabel.length).toBeGreaterThan(0);
    expect(result.incidents[0]!.neutralLabel).not.toMatch(/theft|fraud|misconduct/i);
    // The raw internal enum must be absent, not merely unrendered: this DTO is serialized
    // straight over /api/my/..., so a driver would read `theft_after_hours_movement` in a
    // network tab no matter what the UI chose to display. severity is internal for the
    // same reason — neutralLabel is the only type-ish field a driver may see.
    expect(result.incidents[0]).not.toHaveProperty('incidentType');
    expect(result.incidents[0]).not.toHaveProperty('severity');
  });

  it('uses the caller-supplied terminal window for the recent/history distinction', async () => {
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue({ count: '0' });

    await findDriverIncidents(STAFF, { ...baseParams, terminalWindowDays: 365 });

    const [text, params] = db.query.mock.calls[0]!;
    expect(text).toContain('make_interval(days =>');
    expect(params).toContain(365);
  });

  it('applies optional fromDate/toDate bounds', async () => {
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue({ count: '0' });

    await findDriverIncidents(STAFF, { ...baseParams, fromDate: '2026-01-01', toDate: '2026-08-01' });

    const [text, params] = db.query.mock.calls[0]!;
    expect(text).toContain('detected_at::date >=');
    expect(text).toContain('detected_at::date <=');
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-08-01');
  });
});

describe('findDriverIncidentDetail', () => {
  it('scopes to id and staff id together, and returns null when either does not match', async () => {
    db.queryOne.mockResolvedValue(null);

    const result = await findDriverIncidentDetail(OTHER_STAFF, INCIDENT, {
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0, now: '2026-08-13T00:00:00.000Z',
    });

    expect(result).toBeNull();
    const [text, params] = db.queryOne.mock.calls[0]!;
    expect(text).toMatch(/staff_id = \$1::uuid/);
    expect(text).toMatch(/id = \$2::uuid/);
    expect(params).toEqual([OTHER_STAFF, INCIDENT]);
  });

  it('returns the mapped item for the owning staff member', async () => {
    db.queryOne.mockResolvedValue(incidentListRow);

    const result = await findDriverIncidentDetail(STAFF, INCIDENT, {
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0, now: '2026-08-11T00:00:00.000Z',
    });

    expect(result).toMatchObject({ id: INCIDENT, driverInputState: 'requested' });
  });
});

describe('listVisibleTimeline', () => {
  it('excludes internal rows in SQL and merges actions with evidence, newest first', async () => {
    // Rows arrive already newest-first, exactly as Postgres would return them for the
    // implementation's own `ORDER BY occurred_at DESC` — this repository never re-sorts
    // in JS, matching `../reviewQueries.ts`'s convention of delegating ordering to SQL.
    db.query.mockResolvedValue([
      { id: 'e1', source: 'evidence', type_key: 'photo', visibility: 'driver_submitted', occurred_at: '2026-08-10T09:05:00.000Z', note: null },
      { id: 'a1', source: 'action', type_key: 'driver_response_received', visibility: 'driver_submitted', occurred_at: '2026-08-10T09:00:00.000Z', note: 'Traffic delay on site road' },
      { id: 'a2', source: 'action', type_key: 'driver_input_requested', visibility: 'shared_with_driver', occurred_at: '2026-08-10T08:00:00.000Z', note: 'Please explain the late start' },
    ]);

    const timeline = await listVisibleTimeline(INCIDENT);

    expect(timeline.map((entry) => entry.id)).toEqual(['e1', 'a1', 'a2']);
    expect(timeline[1]).toMatchObject({ kind: 'submission', visibility: 'driver_submitted' });
    expect(timeline[2]).toMatchObject({ kind: 'request', visibility: 'shared_with_driver' });
    expect(timeline[0]).toMatchObject({ kind: 'evidence' });
    const [text, params] = db.query.mock.calls[0]!;
    expect(text).toContain("visibility <> 'internal'");
    expect(params).toEqual([INCIDENT]);
  });

  it('delegates chronological ordering to SQL, and says so in the query', async () => {
    // The assertion above cannot prove ordering: the mock is handed to the function already
    // newest-first and nothing re-sorts in JS, so deleting the ORDER BY — or reversing it to
    // ASC — would leave it green. Ordering is a real guarantee of the driver timeline, so it
    // has to be asserted where it actually lives, in the SQL text.
    db.query.mockResolvedValue([]);

    await listVisibleTimeline(INCIDENT);

    const [text] = db.query.mock.calls[0]!;
    expect(text).toMatch(/ORDER BY\s+occurred_at\s+DESC/i);
    expect(text).not.toMatch(/ORDER BY\s+occurred_at\s+ASC/i);
  });

  it('returns rows in the order SQL gave them, without re-sorting in JS', async () => {
    // The mirror of the above: hand the function deliberately OUT-of-order rows and confirm
    // they come back untouched. If someone ever adds a JS sort, this fails — which is the
    // point, because a JS sort would silently mask a broken ORDER BY.
    db.query.mockResolvedValue([
      { id: 'old', source: 'action', type_key: 'driver_input_requested', visibility: 'shared_with_driver', occurred_at: '2026-08-01T08:00:00.000Z', note: 'first' },
      { id: 'new', source: 'action', type_key: 'driver_response_received', visibility: 'driver_submitted', occurred_at: '2026-08-10T09:00:00.000Z', note: 'later' },
    ]);

    const timeline = await listVisibleTimeline(INCIDENT);

    expect(timeline.map((entry) => entry.id)).toEqual(['old', 'new']);
  });
});
