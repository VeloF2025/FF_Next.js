/**
 * Field Workers admin — typed fetch wrappers.
 *
 * All fetchers use `credentials: 'same-origin'` and throw on non-2xx
 * responses with a human-readable message extracted from the API envelope.
 *
 * The /api/field/users GET handler returns `{ success, data: FieldUserRow[] }`
 * where `data` is the rows array directly (not `{ users: [...] }`).
 * Client-side filter to technician|casual is applied here.
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Roles that map to "field workers" in the pending queue. */
const FIELD_WORKER_ROLES = new Set(['technician', 'casual']);

async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } | string };
      const e = body?.error;
      if (typeof e === 'string') msg = e;
      else if (e?.message) msg = e.message;
    } catch {
      // ignore JSON parse failure — use status message
    }
    throw new Error(msg);
  }
  return res.json();
}

// ── Domain types ──────────────────────────────────────────────────────────────

/**
 * A field worker row returned by GET /api/field/users?accountStatus=pending,
 * filtered client-side to role === 'technician' | 'casual'.
 */
export interface PendingWorker {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  email: string;
  role: string;
  account_status: string;
  created_by_staff_id: string | null;
  created_at: string;
  source: string | null;
  declared_project_id: string | null;
  declared_project_name: string | null;
}

/**
 * Mirror of the FieldAttendanceRow exported from pages/api/field/attendance.ts.
 * Kept here so UI modules can import without reaching into pages/.
 */
export interface FieldAttendanceRow {
  entry_id:         string;
  staff_id:         string;
  staff_name:       string;
  role:             string;
  account_status:   string;
  work_date:        string;
  clock_in_at:      string | null;
  clock_out_at:     string | null;
  entry_status:     string;
  hours:            number | null;
  entry_updated_at: string;
  site_geofence_id: string | null;
}

// Payload types for write endpoints (used by Task 5 / TimeTab)

export interface AdjustEntryPayload {
  entry_id: string;
  adjusted_clock_in_at?: string | null;
  adjusted_clock_out_at?: string | null;
  adjusted_site_geofence_id?: string | null;
  reason: string;
  adjustment_kind: string;
}

export interface AddManualEntryPayload {
  staff_id: string;
  clock_in_at: string;
  clock_out_at: string;
  site_geofence_id?: string;
  /** Minimum 10 characters. */
  notes: string;
}

export interface ReviewCorrectionPayload {
  adjustment_id: string;
  action: 'approve' | 'reject';
  review_note?: string;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

/**
 * List all pending field-worker registrations.
 * Calls GET /api/field/users?accountStatus=pending, reads body.data (array),
 * then filters client-side to technician | casual roles.
 */
export async function listPendingFieldWorkers(): Promise<PendingWorker[]> {
  const body = (await apiFetch('/api/field/users?accountStatus=pending')) as {
    data: PendingWorker[];
  };
  return body.data.filter((r) => FIELD_WORKER_ROLES.has(r.role));
}

/** POST /api/field/users/approve?userId=<id> */
export async function approveWorker(userId: string): Promise<void> {
  await apiFetch(`/api/field/users/approve?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
  });
}

/** POST /api/field/users/suspend?userId=<id>  (rejects / suspends a worker) */
export async function rejectWorker(userId: string): Promise<void> {
  await apiFetch(`/api/field/users/suspend?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
  });
}

// ── Attendance ────────────────────────────────────────────────────────────────

/**
 * GET /api/field/attendance?from=&to=&status=
 * Returns body.data.rows as FieldAttendanceRow[].
 */
export async function getFieldAttendance(
  from: string,
  to: string,
  status: 'all' | 'pending' | 'active' = 'all'
): Promise<FieldAttendanceRow[]> {
  const params = new URLSearchParams({ from, to, status });
  const body = (await apiFetch(`/api/field/attendance?${params.toString()}`)) as {
    data: { rows: FieldAttendanceRow[] };
  };
  return body.data.rows;
}

/**
 * POST /api/field/attendance-adjust
 * Submits an adjustment request for an existing attendance entry.
 */
export async function adjustEntry(payload: AdjustEntryPayload): Promise<void> {
  await apiFetch('/api/field/attendance-adjust', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/staff/attendance-manual-entry
 * Creates a manual attendance entry for a staff member.
 * notes must be >= 10 characters (validated server-side).
 */
export async function addManualEntry(payload: AddManualEntryPayload): Promise<void> {
  await apiFetch('/api/staff/attendance-manual-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/staff/attendance-corrections-review
 * Approve or reject a pending attendance correction request.
 */
export async function reviewCorrection(payload: ReviewCorrectionPayload): Promise<void> {
  await apiFetch('/api/staff/attendance-corrections-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
