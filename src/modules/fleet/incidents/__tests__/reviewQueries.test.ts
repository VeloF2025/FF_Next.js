import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

import {
  getIncidentActions, getIncidentCore, getIncidentCorrectionLinks, getIncidentDeliverySummary,
  getIncidentDriverInputSummary, getIncidentEvidence, listIncidents,
} from '../reviewQueries';
import type { IncidentListRequest } from '../types';
import type { IncidentScopeFilter } from '../reviewScope';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

const baseRequest: IncidentListRequest = { limit: 25, offset: 0 };
const unrestrictedScope: IncidentScopeFilter = { unrestricted: true, pmUserId: USER, pmStaffId: STAFF };
const restrictedScope: IncidentScopeFilter = { unrestricted: false, pmUserId: USER, pmStaffId: STAFF };

const listRow = {
  id: INCIDENT, incident_reference: 'INC-LATE-20260813-ABC123', incident_type: 'late', severity: 'high',
  lifecycle_status: 'open', staff_id: STAFF, staff_name_snapshot: 'Jane', project_id: null,
  project_name_snapshot: null, operational_site_name_snapshot: null, opened_at: '2026-08-13T08:00:00.000Z',
  condition_last_seen_at: '2026-08-13T08:00:00.000Z', condition_cleared_at: null,
  escalation_level: 0, next_escalation_at: null, resolved_at: null, evidence_count: 0,
};

const settingsRow = {
  version: 1, effective_from: '2026-08-01T00:00:00.000Z', effective_to: null,
  response_window_workdays: 2, post_closure_response_enabled: false, post_closure_response_window_days: 0,
  recent_window_days: 90, history_window_days: 365,
  enabled_concern_categories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidence_allowed_mime_types: ['image/jpeg'], evidence_max_bytes: 15728640,
  driver_input_requested_in_app: true, driver_input_requested_email: true, driver_input_requested_whatsapp: false,
  driver_response_received_in_app: true, driver_response_received_email: true, driver_response_received_whatsapp: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.queryOne.mockResolvedValue({ count: '0' });
  db.query.mockResolvedValue([]);
});

describe('listIncidents', () => {
  it('returns mapped incidents and a total count', async () => {
    db.queryOne.mockResolvedValue({ count: '1' });
    db.query.mockResolvedValue([listRow]);
    const result = await listIncidents(baseRequest, unrestrictedScope);
    expect(result.total).toBe(1);
    expect(result.incidents[0]).toMatchObject({ id: INCIDENT, incidentReference: 'INC-LATE-20260813-ABC123', staffName: 'Jane' });
  });

  it('adds a project-ownership filter only for a restricted scope', async () => {
    await listIncidents(baseRequest, restrictedScope);
    const [countText, countParams] = db.queryOne.mock.calls[0]!;
    expect(countText).toContain('EXISTS');
    expect(countParams).toContain(USER);
    expect(countParams).toContain(STAFF);

    vi.clearAllMocks();
    db.queryOne.mockResolvedValue({ count: '0' });
    await listIncidents(baseRequest, unrestrictedScope);
    const [unrestrictedText] = db.queryOne.mock.calls[0]!;
    expect(unrestrictedText).not.toContain('EXISTS');
  });

  it('applies lifecycle, type, severity, date, and overdue filters as explicit query branches', async () => {
    const request: IncidentListRequest = {
      lifecycleStatuses: ['open', 'acknowledged'], incidentTypes: ['late'], severities: ['high'],
      staffId: STAFF, projectId: undefined, fromDate: '2026-08-01', toDate: '2026-08-31',
      overdueOnly: true, conditionState: 'active', evidenceState: 'present', limit: 10, offset: 0,
    };
    await listIncidents(request, unrestrictedScope);
    const [text, params] = db.queryOne.mock.calls[0]!;
    expect(text).toContain('lifecycle_status = ANY');
    expect(text).toContain('incident_type = ANY');
    expect(text).toContain('severity = ANY');
    expect(text).toContain('staff_id =');
    expect(text).toContain('opened_at::date >=');
    expect(text).toContain('opened_at::date <=');
    expect(text).toContain('next_escalation_at');
    expect(text).toContain('condition_cleared_at IS NULL');
    expect(params).toContain(STAFF);
  });

  it('paginates with the requested limit and offset', async () => {
    await listIncidents({ ...baseRequest, limit: 5, offset: 15 }, unrestrictedScope);
    const [selectText, selectParams] = db.query.mock.calls[0]!;
    expect(selectText).toContain('LIMIT');
    expect(selectText).toContain('OFFSET');
    expect(selectParams).toContain(5);
    expect(selectParams).toContain(15);
  });
});

describe('getIncidentCore', () => {
  it('returns null when no row matches', async () => {
    db.queryOne.mockResolvedValue(null);
    expect(await getIncidentCore(INCIDENT)).toBeNull();
  });

  it('maps a full detail row', async () => {
    db.queryOne.mockResolvedValue({
      ...listRow, source_event_id: null, evidence_snapshot: { reason: 'late' }, detected_at: '2026-08-13T08:00:00.000Z',
      acknowledged_by: null, acknowledged_at: null, review_started_by: null, review_started_at: null,
      resolved_by: null, resolved_at: null, outcome: null, resolution_note: null,
      linked_hs_reference: null, linked_maintenance_reference: null, incident_rule_id: null,
    });
    const result = await getIncidentCore(INCIDENT);
    expect(result).toMatchObject({ id: INCIDENT, evidenceSnapshot: { reason: 'late' } });
  });
});

describe('getIncidentActions and getIncidentEvidence', () => {
  it('map append-only action and evidence history', async () => {
    db.query.mockResolvedValueOnce([{
      id: 'a1', action_type: 'acknowledged', actor_user_id: USER, is_system_actor: false, occurred_at: '2026-08-13T08:05:00.000Z',
      note: null, visibility: 'internal', before_lifecycle_status: 'open', after_lifecycle_status: 'acknowledged',
      before_escalation_level: 0, after_escalation_level: 0, metadata: {}, request_correlation_id: null,
    }]);
    const actions = await getIncidentActions(INCIDENT);
    expect(actions).toEqual([expect.objectContaining({ id: 'a1', actionType: 'acknowledged' })]);

    db.query.mockResolvedValueOnce([{
      id: 'e1', evidence_type: 'photo', storage_url: 'https://app.fibreflow.app/storage/x', storage_key: 'x',
      mime_type: 'image/jpeg', original_filename: 'photo.jpg', uploaded_by: USER, description: null,
      visibility: 'internal', created_at: '2026-08-13T08:10:00.000Z',
    }]);
    const evidence = await getIncidentEvidence(INCIDENT);
    expect(evidence).toEqual([expect.objectContaining({ id: 'e1', evidenceType: 'photo' })]);
  });

  it('selects visibility so a manager can distinguish internal notes from driver-shared/driver-submitted ones (migration 511)', async () => {
    await getIncidentActions(INCIDENT);
    const [actionsText] = db.query.mock.calls[0]!;
    expect(actionsText).toMatch(/\bvisibility\b/);

    await getIncidentEvidence(INCIDENT);
    const [evidenceText] = db.query.mock.calls[1]!;
    expect(evidenceText).toMatch(/\bvisibility\b/);
  });

  it('maps each visibility class verbatim onto the returned action/evidence, not just a default', async () => {
    db.query.mockResolvedValueOnce([{
      id: 'a-shared', action_type: 'driver_input_requested', actor_user_id: USER, is_system_actor: false,
      occurred_at: '2026-08-13T08:05:00.000Z', note: 'Please explain', visibility: 'shared_with_driver',
      before_lifecycle_status: 'open', after_lifecycle_status: 'open',
      before_escalation_level: 0, after_escalation_level: 0, metadata: {}, request_correlation_id: null,
    }]);
    const [action] = await getIncidentActions(INCIDENT);
    expect(action?.visibility).toBe('shared_with_driver');

    db.query.mockResolvedValueOnce([{
      id: 'e-driver', evidence_type: 'photo', storage_url: 'https://app.fibreflow.app/storage/y', storage_key: 'y',
      mime_type: 'image/jpeg', original_filename: 'proof.jpg', uploaded_by: null, description: null,
      visibility: 'driver_submitted', created_at: '2026-08-13T08:10:00.000Z',
    }]);
    const [evidence] = await getIncidentEvidence(INCIDENT);
    expect(evidence?.visibility).toBe('driver_submitted');
  });
});

describe('getIncidentDeliverySummary', () => {
  it('counts recorded notifications for this incident without raw payloads', async () => {
    db.queryOne.mockResolvedValue({ count: '2' });
    const summary = await getIncidentDeliverySummary(INCIDENT);
    expect(summary).toEqual({ delivered: 2, suppressed: 0, failed: 0 });
    const [text, params] = db.queryOne.mock.calls[0]!;
    expect(text).not.toMatch(/latitude|longitude/i);
    expect(params).toEqual([INCIDENT]);
  });
});

/**
 * PR7 review C1: correction links were written by the driver-scoped `/my` portal
 * (`attendanceCorrectionLinkService.ts`) and read only there — no manager surface read them
 * at all. Column names asserted here are verified against migration 511
 * (`fleet_incident_attendance_correction_links`: `attendance_correction_id`, `linked_at`) and
 * migration 320 (`attendance_adjustments.status`) — the SQL risk this branch's review
 * specifically warned about, since a mocked DB never catches a wrong column name.
 */
describe('getIncidentCorrectionLinks', () => {
  it('joins the live Attendance status — never a cached one — for every correction linked to this incident', async () => {
    db.query.mockResolvedValueOnce([
      { id: 'link-1', attendance_correction_id: 'adj-1', linked_at: '2026-08-18T09:00:00.000Z', status: 'approved' },
    ]);
    const links = await getIncidentCorrectionLinks(INCIDENT);
    expect(links).toEqual([{ id: 'link-1', attendanceCorrectionId: 'adj-1', linkedAt: '2026-08-18T09:00:00.000Z', correctionState: 'approved' }]);
    const [text, params] = db.query.mock.calls[0]!;
    expect(text).toContain('fleet_incident_attendance_correction_links');
    expect(text).toContain('attendance_adjustments');
    expect(text).toMatch(/\bl\.attendance_correction_id\b/);
    expect(text).toMatch(/\bl\.linked_at\b/);
    expect(text).toMatch(/\ba\.status\b/);
    expect(text).toMatch(/l\.incident_id = \$1::uuid/);
    expect(params).toEqual([INCIDENT]);
  });

  it('returns an empty array — not an error — when no correction is linked yet', async () => {
    db.query.mockResolvedValueOnce([]);
    expect(await getIncidentCorrectionLinks(INCIDENT)).toEqual([]);
  });
});

/**
 * PR7 review I2/I3: the manager badge previously derived from action-timeline ordering alone
 * and could never report `expired`/`closed`, and `respond_by`/`delivery_failed_count` were
 * durable columns nothing manager-facing read. This proves the single source of truth is
 * `deriveDriverInputState` fed by the real `fleet_incident_driver_input_requests`/
 * `fleet_incident_driver_submissions` columns (migration 511) — not a re-derived heuristic.
 */
describe('getIncidentDriverInputSummary', () => {
  const currentRequestRow = {
    incident_id: INCIDENT, requested_at: '2026-08-18T07:00:00.000Z', respond_by: '2026-08-20T21:59:59.999Z', delivery_failed_count: 0,
  };

  it('reads the current non-superseded request and surfaces respondBy, verified against migration 511 columns', async () => {
    db.queryOne.mockResolvedValueOnce(settingsRow);
    db.query.mockResolvedValueOnce([currentRequestRow]);
    db.query.mockResolvedValueOnce([]);

    const summary = await getIncidentDriverInputSummary(INCIDENT, null, '2026-08-19T00:00:00.000Z');

    expect(summary).toEqual({ state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false });
    const [requestsText, requestsParams] = db.query.mock.calls[0]!;
    expect(requestsText).toContain('fleet_incident_driver_input_requests');
    expect(requestsText).toContain('superseded_at IS NULL');
    expect(requestsText).toMatch(/\brequested_at\b/);
    expect(requestsText).toMatch(/\brespond_by\b/);
    expect(requestsText).toMatch(/\bdelivery_failed_count\b/);
    expect(requestsParams).toEqual([[INCIDENT]]);
    const [submissionsText, submissionsParams] = db.query.mock.calls[1]!;
    expect(submissionsText).toContain('fleet_incident_driver_submissions');
    expect(submissionsText).toMatch(/\bcreated_at\b/);
    expect(submissionsParams).toEqual([[INCIDENT]]);
  });

  it('reports deliveryFailed when the current request\'s delivery_failed_count is greater than zero', async () => {
    db.queryOne.mockResolvedValueOnce(settingsRow);
    db.query.mockResolvedValueOnce([{ ...currentRequestRow, delivery_failed_count: 1 }]);
    db.query.mockResolvedValueOnce([]);
    const summary = await getIncidentDriverInputSummary(INCIDENT, null, '2026-08-19T00:00:00.000Z');
    expect(summary.deliveryFailed).toBe(true);
  });

  it('reports not_requested with no respondBy when no current request exists', async () => {
    db.queryOne.mockResolvedValueOnce(settingsRow);
    db.query.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce([]);
    const summary = await getIncidentDriverInputSummary(INCIDENT, null, '2026-08-19T00:00:00.000Z');
    expect(summary).toEqual({ state: 'not_requested', respondBy: null, deliveryFailed: false });
  });

  it('does NOT report responded when the latest submission predates the current request (a stale pre-supersession submission)', async () => {
    db.queryOne.mockResolvedValueOnce(settingsRow);
    db.query.mockResolvedValueOnce([currentRequestRow]);
    db.query.mockResolvedValueOnce([{ incident_id: INCIDENT, responded_at: '2026-08-17T00:00:00.000Z' }]);
    const summary = await getIncidentDriverInputSummary(INCIDENT, null, '2026-08-19T00:00:00.000Z');
    expect(summary.state).toBe('requested');
  });

  it('DOES report responded when the latest submission is at/after the current request', async () => {
    db.queryOne.mockResolvedValueOnce(settingsRow);
    db.query.mockResolvedValueOnce([currentRequestRow]);
    db.query.mockResolvedValueOnce([{ incident_id: INCIDENT, responded_at: '2026-08-18T09:00:00.000Z' }]);
    const summary = await getIncidentDriverInputSummary(INCIDENT, null, '2026-08-19T00:00:00.000Z');
    expect(summary.state).toBe('responded');
  });

  it('reports closed — not requested — when the incident is terminal and post-closure response was never enabled', async () => {
    db.queryOne.mockResolvedValueOnce({ ...settingsRow, post_closure_response_enabled: false, post_closure_response_window_days: 0 });
    db.query.mockResolvedValueOnce([currentRequestRow]);
    db.query.mockResolvedValueOnce([]);
    const summary = await getIncidentDriverInputSummary(INCIDENT, '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
    expect(summary.state).toBe('closed');
  });

  it('remains requested when the incident is terminal but still within its post-closure response window', async () => {
    db.queryOne.mockResolvedValueOnce({ ...settingsRow, post_closure_response_enabled: true, post_closure_response_window_days: 5 });
    db.query.mockResolvedValueOnce([currentRequestRow]);
    db.query.mockResolvedValueOnce([]);
    const summary = await getIncidentDriverInputSummary(INCIDENT, '2026-08-19T00:00:00.000Z', '2026-08-19T12:00:00.000Z');
    expect(summary.state).toBe('requested');
  });
});

/**
 * PR7 review I4: the queue previously had no driver-input surface at all. This proves the
 * attachment is one settings read plus two BATCHED queries for the whole page — never one
 * query per row — and that an empty page skips them entirely (no wasted reads).
 */
describe('listIncidents driverInput attachment', () => {
  it('attaches driverInput using one settings read plus two batched queries for the whole page', async () => {
    db.queryOne.mockResolvedValueOnce({ count: '1' });
    db.query.mockResolvedValueOnce([listRow]);
    db.queryOne.mockResolvedValueOnce(settingsRow);
    db.query.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce([]);

    const result = await listIncidents(baseRequest, unrestrictedScope);

    expect(result.incidents[0]?.driverInput).toEqual({ state: 'not_requested', respondBy: null, deliveryFailed: false });
    expect(db.query).toHaveBeenCalledTimes(3);
    const [requestsText, requestsParams] = db.query.mock.calls[1]!;
    expect(requestsText).toMatch(/= ANY\(\$1::uuid\[\]\)/);
    expect(requestsParams).toEqual([[INCIDENT]]);
  });

  it('skips the settings and batched driver-input reads entirely when the page has no rows', async () => {
    db.queryOne.mockResolvedValueOnce({ count: '0' });
    db.query.mockResolvedValueOnce([]);

    const result = await listIncidents(baseRequest, unrestrictedScope);

    expect(result.incidents).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
    // `queryOne` must also stay at exactly one call (the COUNT) — `getEffectiveDriverInputSettings`
    // also uses `queryOne`, so a wasted settings read on an empty page would not show up in the
    // `db.query` count above at all and would slip past that assertion alone.
    expect(db.queryOne).toHaveBeenCalledTimes(1);
  });
});
