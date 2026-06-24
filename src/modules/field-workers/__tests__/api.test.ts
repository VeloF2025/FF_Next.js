/**
 * Tests for src/modules/field-workers/api.ts
 *
 * Mocks global `fetch`, drives each exported fetcher, and asserts:
 *  - correct URL and HTTP method
 *  - correct request body (for POST calls)
 *  - correct return value extraction
 *  - error propagation on non-2xx
 *  - client-side technician|casual role filter in listPendingFieldWorkers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listPendingFieldWorkers,
  approveWorker,
  rejectWorker,
  getFieldAttendance,
  adjustEntry,
  addManualEntry,
  reviewCorrection,
  type PendingWorker,
  type FieldAttendanceRow,
} from '../api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

function fetchedUrl(): string {
  const mock = vi.mocked(fetch);
  const call = mock.mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  return call[0] as string;
}

function fetchedInit(): RequestInit {
  const mock = vi.mocked(fetch);
  const call = mock.mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  return (call[1] ?? {}) as RequestInit;
}

const PENDING_WORKER_BASE: Omit<PendingWorker, 'role'> = {
  id: 'sf-1',
  first_name: 'Thabo',
  last_name: 'M',
  phone: '0821234567',
  email: '0821234567@phone.local',
  account_status: 'pending',
  created_by_staff_id: null,
  created_at: '2024-01-01T00:00:00.000Z',
  source: 'self_registration',
  declared_project_id: 'proj-1',
  declared_project_name: 'Test Project',
};

const ATTENDANCE_ROW: FieldAttendanceRow = {
  entry_id: 'e-1',
  staff_id: 'sf-1',
  staff_name: 'Thabo M',
  role: 'technician',
  account_status: 'active',
  work_date: '2024-01-15',
  clock_in_at: '2024-01-15T06:00:00Z',
  clock_out_at: '2024-01-15T14:00:00Z',
  entry_status: 'complete',
  hours: 8,
  entry_updated_at: '2024-01-15T14:00:00Z',
  site_geofence_id: null,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ── listPendingFieldWorkers ───────────────────────────────────────────────────

describe('listPendingFieldWorkers', () => {
  it('calls GET /api/field/users?accountStatus=pending', async () => {
    mockFetch({ data: [] });
    await listPendingFieldWorkers();
    expect(fetchedUrl()).toBe('/api/field/users?accountStatus=pending');
    expect(fetchedInit().method).toBeUndefined(); // defaults to GET
  });

  it('uses credentials: same-origin', async () => {
    mockFetch({ data: [] });
    await listPendingFieldWorkers();
    expect(fetchedInit().credentials).toBe('same-origin');
  });

  it('returns only technician and casual rows', async () => {
    const rows: PendingWorker[] = [
      { ...PENDING_WORKER_BASE, role: 'technician' },
      { ...PENDING_WORKER_BASE, id: 'sf-2', role: 'casual' },
      { ...PENDING_WORKER_BASE, id: 'sf-3', role: 'stores' },   // excluded
      { ...PENDING_WORKER_BASE, id: 'sf-4', role: 'supervisor' }, // excluded
    ];
    mockFetch({ data: rows });
    const result = await listPendingFieldWorkers();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.role)).toEqual(['technician', 'casual']);
  });

  it('returns all fields including source and declared_project_name', async () => {
    mockFetch({ data: [{ ...PENDING_WORKER_BASE, role: 'technician' }] });
    const result = await listPendingFieldWorkers();
    expect(result[0]).toMatchObject({
      source: 'self_registration',
      declared_project_id: 'proj-1',
      declared_project_name: 'Test Project',
    });
  });

  it('throws on non-2xx response', async () => {
    mockFetch({ error: { message: 'Forbidden' } }, 403);
    await expect(listPendingFieldWorkers()).rejects.toThrow('Forbidden');
  });
});

// ── approveWorker ─────────────────────────────────────────────────────────────

describe('approveWorker', () => {
  it('calls POST /api/field/users/approve?userId=<id>', async () => {
    mockFetch({ success: true, data: {} });
    await approveWorker('sf-abc');
    expect(fetchedUrl()).toBe('/api/field/users/approve?userId=sf-abc');
    expect(fetchedInit().method).toBe('POST');
  });

  it('URL-encodes the userId', async () => {
    mockFetch({ success: true, data: {} });
    await approveWorker('sf a&b');
    expect(fetchedUrl()).toBe('/api/field/users/approve?userId=sf%20a%26b');
  });

  it('resolves void on success', async () => {
    mockFetch({ success: true, data: {} });
    await expect(approveWorker('sf-1')).resolves.toBeUndefined();
  });

  it('throws on error', async () => {
    mockFetch({ error: 'Unauthorized' }, 401);
    await expect(approveWorker('sf-1')).rejects.toThrow('Unauthorized');
  });
});

// ── rejectWorker ──────────────────────────────────────────────────────────────

describe('rejectWorker', () => {
  it('calls POST /api/field/users/suspend?userId=<id>', async () => {
    mockFetch({ success: true, data: {} });
    await rejectWorker('sf-xyz');
    expect(fetchedUrl()).toBe('/api/field/users/suspend?userId=sf-xyz');
    expect(fetchedInit().method).toBe('POST');
  });

  it('resolves void on success', async () => {
    mockFetch({ success: true, data: {} });
    await expect(rejectWorker('sf-1')).resolves.toBeUndefined();
  });

  it('throws on error', async () => {
    mockFetch({ error: { message: 'Not found' } }, 404);
    await expect(rejectWorker('sf-1')).rejects.toThrow('Not found');
  });
});

// ── getFieldAttendance ────────────────────────────────────────────────────────

describe('getFieldAttendance', () => {
  it('calls GET /api/field/attendance with from, to, status params', async () => {
    mockFetch({ data: { rows: [] } });
    await getFieldAttendance('2024-01-01', '2024-01-31', 'active');
    expect(fetchedUrl()).toBe('/api/field/attendance?from=2024-01-01&to=2024-01-31&status=active');
  });

  it('defaults status to "all"', async () => {
    mockFetch({ data: { rows: [] } });
    await getFieldAttendance('2024-01-01', '2024-01-31');
    expect(fetchedUrl()).toContain('status=all');
  });

  it('returns the rows array', async () => {
    mockFetch({ data: { rows: [ATTENDANCE_ROW] } });
    const result = await getFieldAttendance('2024-01-01', '2024-01-31');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ entry_id: 'e-1', hours: 8 });
  });

  it('throws on non-2xx', async () => {
    mockFetch({ error: 'Bad date' }, 400);
    await expect(getFieldAttendance('bad', 'dates')).rejects.toThrow('Bad date');
  });
});

// ── adjustEntry ───────────────────────────────────────────────────────────────

describe('adjustEntry', () => {
  it('calls POST /api/field/attendance-adjust with the payload body', async () => {
    mockFetch({ success: true, data: {} });
    const payload = {
      entry_id: 'e-1',
      adjusted_clock_out_at: '2024-01-15T15:00:00Z',
      reason: 'Left site late',
      adjustment_kind: 'clock_out_correction',
    };
    await adjustEntry(payload);
    expect(fetchedUrl()).toBe('/api/field/attendance-adjust');
    expect(fetchedInit().method).toBe('POST');
    expect(JSON.parse(fetchedInit().body as string)).toEqual(payload);
  });

  it('sets Content-Type: application/json', async () => {
    mockFetch({ success: true, data: {} });
    await adjustEntry({ entry_id: 'e-1', reason: 'test', adjustment_kind: 'kind' });
    const headers = fetchedInit().headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ── addManualEntry ────────────────────────────────────────────────────────────

describe('addManualEntry', () => {
  it('calls POST /api/staff/attendance-manual-entry with the payload body', async () => {
    mockFetch({ success: true, data: {} });
    const payload = {
      staff_id: 'sf-1',
      clock_in_at: '2024-01-15T06:00:00Z',
      clock_out_at: '2024-01-15T14:00:00Z',
      notes: 'Manual entry for field day',
    };
    await addManualEntry(payload);
    expect(fetchedUrl()).toBe('/api/staff/attendance-manual-entry');
    expect(fetchedInit().method).toBe('POST');
    expect(JSON.parse(fetchedInit().body as string)).toEqual(payload);
  });
});

// ── reviewCorrection ──────────────────────────────────────────────────────────

describe('reviewCorrection', () => {
  it('calls POST /api/staff/attendance-corrections-review with the payload', async () => {
    mockFetch({ success: true, data: {} });
    const payload = { adjustment_id: 'adj-1', action: 'approve' as const };
    await reviewCorrection(payload);
    expect(fetchedUrl()).toBe('/api/staff/attendance-corrections-review');
    expect(fetchedInit().method).toBe('POST');
    expect(JSON.parse(fetchedInit().body as string)).toEqual(payload);
  });

  it('passes reject action with review_note', async () => {
    mockFetch({ success: true, data: {} });
    await reviewCorrection({
      adjustment_id: 'adj-2',
      action: 'reject',
      review_note: 'Hours incorrect',
    });
    const body = JSON.parse(fetchedInit().body as string) as Record<string, unknown>;
    expect(body.action).toBe('reject');
    expect(body.review_note).toBe('Hours incorrect');
  });
});
