import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

import { getIncidentActions, getIncidentCore, getIncidentDeliverySummary, getIncidentEvidence, listIncidents } from '../reviewQueries';
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
  escalation_level: 0, next_escalation_at: null, evidence_count: 0,
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
      note: null, before_lifecycle_status: 'open', after_lifecycle_status: 'acknowledged',
      before_escalation_level: 0, after_escalation_level: 0, metadata: {}, request_correlation_id: null,
    }]);
    const actions = await getIncidentActions(INCIDENT);
    expect(actions).toEqual([expect.objectContaining({ id: 'a1', actionType: 'acknowledged' })]);

    db.query.mockResolvedValueOnce([{
      id: 'e1', evidence_type: 'photo', storage_url: 'https://app.fibreflow.app/storage/x', storage_key: 'x',
      mime_type: 'image/jpeg', original_filename: 'photo.jpg', uploaded_by: USER, description: null, created_at: '2026-08-13T08:10:00.000Z',
    }]);
    const evidence = await getIncidentEvidence(INCIDENT);
    expect(evidence).toEqual([expect.objectContaining({ id: 'e1', evidenceType: 'photo' })]);
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
