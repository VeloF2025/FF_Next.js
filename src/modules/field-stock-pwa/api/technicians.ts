/**
 * Technician API helpers for the field-stock PWA.
 *
 * Hydration strategy for createTechnician:
 *   The POST /api/field/users endpoint returns only { id, role, account_status,
 *   created_by_staff_id } — it intentionally omits the full staff row. Rather
 *   than making a second GET request, we merge the known input fields
 *   (firstName, lastName, phone, contractorId) with the returned id/accountStatus.
 *   This is sufficient for the PickTechStep UI; a full re-fetch (fetchTechnicianById)
 *   is deferred to Task 2.3 when the component actually needs it.
 *
 * NOTE: fetchTechnicianById is not implemented in this task — add a TODO marker
 * so the linter catches it if a caller tries to use it before Task 2.3.
 */

import { request } from './request';
import type { PwaTechSummary } from '../types';

// =============================================================================
// Server row shapes
// =============================================================================

interface FieldUserRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  account_status: string;
  created_by_staff_id: string | null;
  created_at: string;
  // Site fields, annotated server-side by /api/my/stores/technicians.
  site_project_id?: string | null;
  site_project_name?: string | null;
  site_source?: 'assigned' | 'declared' | 'none';
  site_match?: 'match' | 'elsewhere' | 'unknown-staff' | 'unmapped-store';
}

interface FieldUserCreated {
  id: string;
  role: string;
  account_status: string;
  created_by_staff_id: string | null;
}

// =============================================================================
// Mapper
// =============================================================================

function mapFieldUserRow(row: FieldUserRow): PwaTechSummary {
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`.trim(),
    phone: row.phone ?? null,
    // Contractor linkage lives on the picking row, not on staff (per design).
    contractorId: null,
    contractorName: null,
    accountStatus: row.account_status as PwaTechSummary['accountStatus'],
    role: row.role ?? null,
    siteProjectId: row.site_project_id ?? null,
    siteProjectName: row.site_project_name ?? null,
    siteSource: (row.site_source ?? 'none') as PwaTechSummary['siteSource'],
    siteMatch: (row.site_match ?? 'unmapped-store') as PwaTechSummary['siteMatch'],
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch the list of technicians, optionally filtered by search term or
 * contractor association.
 *
 * The /api/field/users endpoint accepts `role` and `accountStatus` only;
 * it has no `search` or `contractorId` param. Filtering is done client-side
 * after the full list is loaded (max 200 rows from the server).
 *
 * TODO(Task 2.3): add server-side search param to /api/field/users if the
 *   200-row limit becomes a problem in production.
 */
export async function fetchTechnicians(
  opts: { search?: string; contractorId?: string; storeLocationId?: string | null } = {}
): Promise<PwaTechSummary[]> {
  // Both roles: casuals receive stock exactly like technicians, and the old
  // single-role request excluded every one of them from the picker.
  const params = new URLSearchParams({ roles: 'technician,casual' });
  if (opts.storeLocationId) params.set('storeLocationId', opts.storeLocationId);
  const rows = await request<FieldUserRow[]>(`/api/my/stores/technicians?${params.toString()}`);
  const mapped = rows.map(mapFieldUserRow);

  let result = mapped;

  if (opts.search) {
    const lower = opts.search.toLowerCase();
    result = result.filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        (t.phone ?? '').toLowerCase().includes(lower)
    );
  }

  if (opts.contractorId) {
    // Contractor linkage is not on staff rows — this filter is a no-op until
    // Task 2.6 plumbs contractorId through the picking->staff join.
    // TODO(Task 2.6): filter by contractorId once the server exposes it.
  }

  return result;
}

/**
 * Create a new technician account. Stores callers get account_status=pending;
 * admin callers get active (server-enforced).
 *
 * Hydration: merges input fields with the minimal server response rather than
 * re-fetching. The contractorId is preserved from input (even though the staff
 * row has no contractor FK) so the caller can pass it to the picking body.
 */
export async function createTechnician(input: {
  firstName: string;
  lastName: string;
  phone: string;
  contractorId?: string | null;
}): Promise<PwaTechSummary> {
  const envelope = await request<{ user: FieldUserCreated }>('/api/my/stores/technicians', {
    method: 'POST',
    body: JSON.stringify({
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: 'technician',
    }),
  });

  return {
    id: envelope.user.id,
    name: `${input.firstName} ${input.lastName}`.trim(),
    phone: input.phone,
    // Preserve caller-supplied contractorId in the returned summary.
    // This field is NOT persisted on staff — it must be threaded into the picking body.
    contractorId: input.contractorId ?? null,
    contractorName: null, // caller must look up name from fetchContractors() if needed
    role: 'technician',
    // A just-created person has no site yet. 'unknown-staff' keeps them visible:
    // the storeman created them seconds ago precisely in order to issue to them.
    siteProjectId: null,
    siteProjectName: null,
    siteSource: 'none',
    siteMatch: 'unknown-staff',
    accountStatus: envelope.user.account_status as PwaTechSummary['accountStatus'],
  };
}
