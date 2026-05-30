/**
 * Sibling validation helpers for pickings/index.ts (POST handler).
 *
 * The underscore prefix is intentional — Next.js ignores files that start with
 * an underscore when scanning pages/api for route handlers. This file is not a
 * route; it is a private module for the pickings handler only.
 *
 * Exports two pure async validators that return a discriminated union:
 *   { ok: true }  — validation passed; caller may continue.
 *   { ok: false; status: number; body: object } — validation failed; caller
 *     should send `res.status(status).json(body)` and return.
 *
 * The `body` shape matches ApiErrorResponse so callers can pass it directly to
 * `res.status(result.status).json(result.body)` without further transformation.
 */

// 🟢 WORKING: extracted from pickings/index.ts to bring that file under 300 lines

import { neon } from '@neondatabase/serverless';
import { ErrorCode } from '@/lib/apiResponse';
import { FIELD_DEFAULT_LOCATION_ID } from '@/modules/field-stock-pwa/lib/locationDefaults';

// ---------------------------------------------------------------------------
// Shape contract
// ---------------------------------------------------------------------------
// apiResponse.error(res, ErrorCode.BAD_REQUEST, message, { code: '...', ... })
// produces:
//   { success: false, error: { code: 'BAD_REQUEST', message, details: { code: '...' } } }
//
// Validators must mirror this shape so existing tests that assert
//   body.error.code === 'BAD_REQUEST' AND body.error.details.code === '...'
// continue to pass unchanged.

// ---------------------------------------------------------------------------
// Shared types (re-declared here to avoid a circular import with index.ts)
// ---------------------------------------------------------------------------

/** Minimal picking line shape consumed by both validators. */
export interface PickingLine {
  stockItemId: string;
  plannedQuantity: number;
  serialIds?: string[];
  lotNumber?: string;
  notes?: string;
}

/** The subset of the POST body relevant to the FIELD-DEFAULT guard. */
export interface PickingBody {
  destinationLocationId?: string;
  technicianId?: string;
}

/**
 * Discriminated union returned by every validator.
 *
 * The success branch carries an optional resolvedSerialIds map so the caller
 * can swap the client-supplied serial_number strings for the authoritative
 * stock_serials.id UUIDs before writing to stock_picking_lines.serial_ids
 * (a uuid[] column). The map is only populated when at least one line carried
 * serialIds; lines without serials produce an empty map.
 */
export type ValidationResult =
  | { ok: true; resolvedSerialIds?: Map<string, string> } // serial_number → uuid
  | { ok: false; status: number; body: object };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an ApiErrorResponse-shaped body matching the output of
 * `apiResponse.error(res, ErrorCode.BAD_REQUEST, message, details)`.
 *
 * The top-level `error.code` is always `ErrorCode.BAD_REQUEST` so that callers
 * asserting `body.error.code === 'BAD_REQUEST'` pass. Business-specific codes
 * are carried in `error.details`.
 */
function badRequestBody(message: string, details: object): object {
  return {
    success: false,
    error: {
      code: ErrorCode.BAD_REQUEST,
      message,
      details,
    },
    meta: { timestamp: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Validator 1: FIELD-DEFAULT requires technicianId
// ---------------------------------------------------------------------------

/**
 * Guard: when the destination is the FIELD_DEFAULT_LOCATION_ID, technicianId
 * MUST be supplied.
 *
 * Without this guard a malicious or buggy client that omits technicianId can
 * bypass the R5k pending-tech value cap (which short-circuits on `if (technicianId)`).
 *
 * @returns `{ ok: true }` if the guard passes; `{ ok: false, status, body }` to reject.
 */
export async function validateFieldDefaultDestination(
  body: PickingBody,
): Promise<ValidationResult> {
  if (
    body.destinationLocationId === FIELD_DEFAULT_LOCATION_ID &&
    !body.technicianId
  ) {
    return {
      ok: false,
      status: 400,
      body: badRequestBody(
        'technicianId is required when issuing stock to the field default location.',
        { code: 'FIELD_DEFAULT_REQUIRES_TECHNICIAN' },
      ),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Validator 2: Serial availability
// ---------------------------------------------------------------------------

/**
 * Re-validate every serial in every line before any INSERT, and resolve the
 * client-supplied serial_number strings to their authoritative
 * stock_serials.id UUIDs.
 *
 * The PWA client sends `serialIds` as an array of serial_number strings
 * (human-readable labels printed on the hardware, e.g. 'ALCLB48CA1DC').
 * stock_picking_lines.serial_ids is a uuid[] column that holds the PK of each
 * serial. Querying by serial_number (text) instead of id (uuid) avoids the
 * Postgres uuid-format error that was causing the 500.
 *
 * Fail fast here so no partial state is written. Pattern borrowed from
 * pickings/[pickingId]/process.ts.
 *
 * @param sql - The Neon SQL client instance from the calling handler.
 * @param lines - Array of picking lines from the request body.
 * @returns `{ ok: true; resolvedSerialIds }` where resolvedSerialIds maps
 *   each serial_number to its UUID; `{ ok: false, status, body }` to reject.
 */
export async function validateSerialsAvailable(
  sql: ReturnType<typeof neon<false, false>>,
  lines: PickingLine[],
): Promise<ValidationResult> {
  const unavailableSerials: string[] = [];
  // Maps serial_number (client-supplied label) → stock_serials.id (uuid)
  const resolvedSerialIds = new Map<string, string>();

  for (const line of lines) {
    if (!Array.isArray(line.serialIds) || line.serialIds.length === 0) continue;

    for (const serialNumber of line.serialIds) {
      // Scope by stock_item_id: the UNIQUE constraint is composite
      // (stock_item_id, serial_number), so the same label can exist across
      // different item types. Without this filter LIMIT 1 picks an arbitrary
      // row when labels collide across products.
      const serialRows = await sql`
        SELECT id, serial_number FROM stock_serials
        WHERE serial_number = ${serialNumber}
          AND stock_item_id = ${line.stockItemId}
          AND status IN ('available', 'in_stock')
        LIMIT 1
      `;
      const row = (serialRows as Array<{ id: string; serial_number: string }>)[0];
      if (!row) {
        unavailableSerials.push(serialNumber);
      } else {
        resolvedSerialIds.set(serialNumber, row.id);
      }
    }
  }

  if (unavailableSerials.length > 0) {
    return {
      ok: false,
      status: 400,
      body: badRequestBody(
        `The following serials are not available: ${unavailableSerials.join(', ')}`,
        { code: 'SERIAL_NOT_AVAILABLE', unavailableSerials },
      ),
    };
  }

  return { ok: true, resolvedSerialIds };
}
