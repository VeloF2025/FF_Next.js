/**
 * Client-side API helpers for the field-stock PWA (/my/stores).
 *
 * All functions:
 *  - Run entirely in the browser (no server imports, no pg.Pool).
 *  - Use the same `request` helper pattern as attendance/portal/client/api.ts:
 *    credentials: 'include', JSON Content-Type, ApiError on non-2xx.
 *  - Map snake_case server rows to camelCase PWA types.
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
 *
 * Contractor endpoint:
 *   The list of contractors is at GET /api/contractors-list (not /api/contractors).
 *   It returns { id, company_name, contact_person, status } rows.
 *
 * Serial validation:
 *   GET /api/procurement/field-stock/serials/[serialNumber] returns a StockSerial
 *   via getSerialByNumber which does NOT join stock_items, so itemName is absent.
 *   validateSerial therefore returns stockItemName: undefined when the serial exists
 *   but has no joined item name. Callers must handle the optional field gracefully.
 */

import type { PwaTechSummary, PwaIssueDraft, PwaPickingResult } from './types';

// =============================================================================
// Shared fetch primitive — mirrors attendance/portal/client/api.ts
// =============================================================================

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection.',
      { cause: message }
    );
  }

  let bodyText = '';
  let envelope: ApiEnvelope<T> | null = null;
  try {
    bodyText = await res.text();
    envelope = bodyText ? (JSON.parse(bodyText) as ApiEnvelope<T>) : null;
  } catch {
    throw new ApiError(
      res.status,
      'PARSE_ERROR',
      `Server returned non-JSON (HTTP ${res.status})`,
      { bodySnippet: bodyText.slice(0, 200) }
    );
  }

  if (!envelope) {
    throw new ApiError(res.status, 'EMPTY_RESPONSE', `Empty response (HTTP ${res.status})`);
  }

  if (!res.ok || !envelope.success) {
    const err = envelope.error ?? { code: 'UNKNOWN', message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return envelope.data as T;
}

// =============================================================================
// Server row shapes (snake_case, as returned by the API)
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
}

interface FieldUserCreated {
  id: string;
  role: string;
  account_status: string;
  created_by_staff_id: string | null;
}

interface ContractorRow {
  id: string;
  company_name: string;
  contact_person: string | null;
  status: string;
}

/** Shape returned by GET /api/procurement/field-stock/serials/[serialNumber] */
interface SerialRow {
  id: string;
  stockItemId: string;
  serialNumber: string;
  status: string;
  /** Present only when the serial service was called via getSerials (with joins). */
  itemName?: string;
}

// =============================================================================
// Mappers
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
  };
}

// =============================================================================
// Technicians
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
  opts: { search?: string; contractorId?: string } = {}
): Promise<PwaTechSummary[]> {
  const rows = await request<FieldUserRow[]>('/api/field/users?role=technician');
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
  const envelope = await request<{ user: FieldUserCreated }>('/api/field/users', {
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
    accountStatus: envelope.user.account_status as PwaTechSummary['accountStatus'],
  };
}

// =============================================================================
// Contractors
// =============================================================================

/**
 * Fetch the contractor dropdown list.
 * Uses /api/contractors-list (not /api/contractors which is a detail endpoint).
 */
export async function fetchContractors(): Promise<Array<{ id: string; name: string }>> {
  const rows = await request<ContractorRow[]>('/api/contractors-list');
  return rows.map((r) => ({ id: r.id, name: r.company_name }));
}

// =============================================================================
// Serial validation
// =============================================================================

/**
 * Validate a scanned serial number against the stock serials table.
 *
 * Returns valid=true when the serial exists and has status 'available'.
 * stockItemName may be undefined — the single-serial endpoint does not join
 * stock_items. Callers should display stockItemId as a fallback.
 *
 * Returns valid=false (with errorMessage) when:
 *  - Serial not found (404)
 *  - Serial status is not 'available' (e.g. 'issued', 'installed')
 *  - Any unexpected API error
 */
export async function validateSerial(serialNumber: string): Promise<{
  valid: boolean;
  stockItemId?: string;
  stockItemName?: string;
  errorMessage?: string;
}> {
  try {
    const serial = await request<SerialRow>(
      `/api/procurement/field-stock/serials/${encodeURIComponent(serialNumber)}`
    );

    if (serial.status !== 'available') {
      return {
        valid: false,
        stockItemId: serial.stockItemId,
        stockItemName: serial.itemName,
        errorMessage: `Serial is not available (status: ${serial.status})`,
      };
    }

    return {
      valid: true,
      stockItemId: serial.stockItemId,
      stockItemName: serial.itemName,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { valid: false, errorMessage: 'Serial number not found' };
    }
    // Propagate unexpected errors so the caller's error boundary handles them.
    throw err;
  }
}

// =============================================================================
// Serial-tracked stock items
// =============================================================================

/**
 * Server row shape returned by GET /api/procurement/field-stock/items.
 * Only the fields needed for PickItemStep (and SignAndSubmitStep) are mapped.
 *
 * standard_cost is the procurement module's unit-value column for stock items.
 * It is returned as a numeric string by the Postgres driver; we parse it to
 * a JS number. If absent or null, unitValueZar is null — the R5k cap guard
 * treats null as non-blocking client-side but warns; the server re-checks.
 */
interface StockItemRow {
  id: string;
  name: string;
  item_code: string | null;
  tracking_type: string;
  /** Per-unit value in ZAR excl VAT, from stock_items.standard_cost. */
  standard_cost: string | null;
}

/**
 * Fetch all active stock items that use serial-number tracking.
 *
 * Uses GET /api/procurement/field-stock/items?trackingType=serial
 * which filters server-side (Branch 5 in items.ts). Client-side
 * search filtering is applied when `opts.search` is provided.
 *
 * The endpoint returns at most 100 rows. If the catalogue grows
 * beyond that, a dedicated paginated endpoint will be needed.
 * TODO(Task 2.7): evaluate if 100-row cap is sufficient in production.
 */
export async function fetchSerialStockItems(
  opts: { search?: string } = {}
): Promise<Array<{ id: string; name: string; sku: string | null; unitValueZar: number | null }>> {
  const params = new URLSearchParams({ trackingType: 'serial' });
  if (opts.search) {
    params.set('search', opts.search);
  }
  const rows = await request<StockItemRow[]>(
    `/api/procurement/field-stock/items?${params.toString()}`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.item_code ?? null,
    // standard_cost comes back as a numeric string from pg; parse to float.
    // Null means the item has no valuation — cap guard will warn but not block.
    unitValueZar: r.standard_cost != null ? parseFloat(r.standard_cost) : null,
  }));
}

// =============================================================================
// Submit issue picking
// =============================================================================

/**
 * Submit a completed issue draft to the server.
 *
 * Maps PwaIssueDraft to the POST /api/procurement/field-stock/pickings body.
 * Both sourceLocationId and destinationLocationId are required fields on
 * PwaIssueDraft and must be valid FK references to stock_locations.id:
 *  - sourceLocationId: the warehouse chosen by the stores person (PickWarehouseStep).
 *  - destinationLocationId: the fixed FIELD-DEFAULT UUID seeded by migration 357.
 *
 * serial_ids on each line are the stock serial number strings (not UUIDs); the
 * pickings endpoint stores them in the serial_ids column on the picking line.
 */
export async function submitIssue(draft: PwaIssueDraft): Promise<PwaPickingResult> {
  const body = {
    pickingType: 'issue',
    sourceLocationId: draft.sourceLocationId,
    destinationLocationId: draft.destinationLocationId,
    technicianId: draft.technicianId,
    contractorId: draft.contractorId ?? undefined,
    notes: draft.notes || undefined,
    lines: [
      {
        stockItemId: draft.stockItemId,
        plannedQuantity: draft.serials.length,
        serialIds: draft.serials.map((s) => s.serialNumber),
        notes: draft.notes || undefined,
      },
    ],
    ...(draft.signatureDataUrl ? { signatureDataUrl: draft.signatureDataUrl } : {}),
  };

  const picking = await request<{
    id: string;
    picking_number: string;
    status: string;
  }>('/api/procurement/field-stock/pickings', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    pickingId: picking.id,
    pickingNumber: picking.picking_number,
    status: picking.status as PwaPickingResult['status'],
  };
}
