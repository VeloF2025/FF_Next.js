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
import { log } from '@/lib/logger';
import { serialsEligibleForIntake } from '@/modules/field-stock-pwa/lib/boxScan';

/** Postgres unique-violation: a duplicate is an answer here, not a crash. */
const UNIQUE_VIOLATION = '23505';

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
  /**
   * The RAW decoded carton payloads for this line — one per carton scanned.
   *
   * The server re-derives which serials they corroborate
   * (serialsEligibleForIntake) instead of trusting a client-supplied "this was
   * machine-read" list. Only serials a payload itself lists may be taken into
   * stock when the sheet has never listed them; anything else is refused,
   * because a typo must not become a permanent phantom ONT issued to a named
   * technician.
   *
   * An ARRAY, because one handout can contain more than one carton of the same
   * item. Checking against only the first would refuse the second carton's
   * genuinely scanned serials.
   */
  intakeScanPayloads?: string[] | null;
  /** The carton's package id, so a box's serials stay traceable together. */
  intakeCartonId?: string | null;
  /**
   * Label photographs for SINGLE units the sheet has never listed, keyed by
   * serial.
   *
   * A carton corroborates itself — nine serials and a declared count. A lone
   * unit does not, and a Gizzu has no carton, so without this a Gizzu the
   * workbook lacks could not be issued at all (field report 2026-08-21). The
   * photo is the substitute evidence.
   *
   * What it proves: a real unit with a label existed, tied to a named storeman
   * at a known time, checkable afterwards. What it does NOT prove: that the
   * typed digits match the label. It makes an unverifiable claim auditable, it
   * does not make it verified.
   */
  intakePhotos?: Array<{ serialNumber: string; photoKey: string; photoUrl?: string | null }>;
}

/** Context the serial validator needs in order to take unlisted stock in. */
export interface SerialValidationContext {
  /** Warehouse the handout is FROM — where a newly-taken-in serial now lives. */
  sourceLocationId?: string | null;
  /** The storeman scanning it in. */
  actorStaffId?: string | null;
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
  ctx: SerialValidationContext = {},
): Promise<ValidationResult> {
  const unavailableSerials: string[] = [];
  // Maps serial_number (client-supplied label) → stock_serials.id (uuid)
  const resolvedSerialIds = new Map<string, string>();
  // Computed once for the whole request — see photoUsageAcrossLines.
  const photoUsage = photoUsageAcrossLines(lines);

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
      if (row) {
        resolvedSerialIds.set(serialNumber, row.id);
        continue;
      }

      // Unlisted, but read from a printed barcode: take it in rather than
      // refuse the handout. The stock is physically on the shelf — a real
      // carton scanned on 2026-08-21 had all 9 of its serials refused because
      // the workbook lacked that consignment. Refusing does not prevent the
      // handout, only its recording.
      // Two ways an unlisted serial may be taken in, and no third:
      //   - a CARTON payload lists it (derived server-side, never asserted by
      //     the caller, so a serial smuggled into the line but absent from
      //     every scan cannot get through), or
      //   - a LABEL PHOTOGRAPH was captured for it.
      const photo = photoFor(line, serialNumber, photoUsage);
      if (corroboratedFor(line).has(serialNumber) || photo) {
        const createdId = await takeSerialIntoStock(sql, {
          serialNumber,
          stockItemId: line.stockItemId,
          locationId: ctx.sourceLocationId ?? null,
          cartonId: line.intakeCartonId ?? null,
          actorStaffId: ctx.actorStaffId ?? null,
          photoKey: photo?.photoKey ?? null,
          photoUrl: photo?.photoUrl ?? null,
        });
        if (createdId) {
          resolvedSerialIds.set(serialNumber, createdId);
          continue;
        }
        // Creation lost a race or the serial exists in a non-issuable state.
        // Fall through and refuse rather than issue something unresolved.
      }

      unavailableSerials.push(serialNumber);
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

/**
 * The label photograph captured for one serial, if any.
 *
 * Matched on the serial itself, so a photo attached to a DIFFERENT serial
 * cannot be reused to admit this one.
 *
 * ONE PHOTO, ONE UNIT. A key that appears against more than one serial admits
 * NEITHER. The feature's whole claim is that a photograph evidences a specific
 * physical unit; a single picture standing for ten Gizzus is not evidence, it
 * is a formality. Refusing both rather than the later one keeps the outcome
 * independent of array order, so the same request cannot admit different
 * serials depending on how the client happened to sort them — and the client
 * does not guarantee that order, so first-wins would let an idempotent replay
 * admit different serials on different attempts.
 *
 * Counted across EVERY line, not within one. Two lines of the same request
 * are the same submission by the same person at the same moment; letting a key
 * repeat between them would leave the unique index (migration 520) to catch it
 * as a raw database error instead of a clear refusal.
 */
function photoUsageAcrossLines(lines: PickingLine[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const line of lines) {
    for (const p of line.intakePhotos ?? []) {
      if (!p || typeof p.photoKey !== 'string' || p.photoKey.trim().length === 0) continue;
      usage.set(p.photoKey, [...(usage.get(p.photoKey) ?? []), p.serialNumber]);
    }
  }
  return usage;
}

function photoFor(
  line: PickingLine,
  serialNumber: string,
  usage: Map<string, string[]>,
): { photoKey: string; photoUrl?: string | null } | null {
  const match = (line.intakePhotos ?? []).find(
    (p) => p && typeof p.photoKey === 'string' && p.photoKey.trim().length > 0
      && p.serialNumber === serialNumber,
  );
  if (!match) return null;

  const usedFor = usage.get(match.photoKey) ?? [];
  if (usedFor.length > 1) {
    log.warn('label photo offered for more than one serial — refusing all of them', {
      photoKey: match.photoKey, serialNumber, usedFor,
    }, 'pickings/_validation');
    return null;
  }
  return { photoKey: match.photoKey, photoUrl: match.photoUrl ?? null };
}

/**
 * Every serial the line's carton scans corroborate, unioned across payloads.
 *
 * Computed per line rather than per serial so a 9-serial carton parses once
 * instead of nine times.
 */
function corroboratedFor(line: PickingLine): Set<string> {
  const payloads = Array.isArray(line.intakeScanPayloads) ? line.intakeScanPayloads : [];
  const all = new Set<string>();
  for (const payload of payloads) {
    for (const serial of serialsEligibleForIntake(payload)) all.add(serial);
  }
  return all;
}

/**
 * Create a serial the stock sheet has never listed, as `field_intake`
 * (migration 515), and return its id.
 *
 * Created `in_stock` at the source warehouse and NOT as 'issued': a trigger
 * (trg_stock_serial_holder_validate) refuses `issued` without a holder, and
 * the picking's own process step is what assigns the holder. So this row
 * joins the ordinary flow at the ordinary place and every downstream path —
 * custody, promotion, the mig-387 event triggers — treats it like any other.
 *
 * NOT transactional with the picking — and note that createPicking has no
 * transaction at all: its `sql` is a bare neon() HTTP client, so the header
 * insert, the line inserts and this one each autocommit independently. An
 * earlier version of this comment said the intake was "deliberately outside
 * the transaction", which implied one existed.
 *
 * So if a later step fails, this row stays committed as available stock at the
 * source warehouse with provenance='field_intake', not linked to any picking
 * or holder. That is a real orphan, and worth being plain about rather than
 * calling it deliberate: it is TRUE in the sense that the carton really is on
 * the shelf, and it is discoverable (the unconfirmed intake report lists it
 * with its carton id and who took it in) — but nothing records which handout
 * failed to use it, so it can look like ordinary available stock to the next
 * storeman. Making it atomic needs createPicking to gain a transaction, which
 * is a larger change than this one.
 *
 * ON CONFLICT DO NOTHING + re-select makes a retry idempotent: a second
 * attempt resolves the row the first one created rather than erroring.
 */
async function takeSerialIntoStock(
  sql: ReturnType<typeof neon<false, false>>,
  opts: {
    serialNumber: string;
    stockItemId: string;
    locationId: string | null;
    cartonId: string | null;
    actorStaffId: string | null;
    photoKey: string | null;
    photoUrl: string | null;
  },
): Promise<string | null> {
  let inserted: unknown;
  try {
    inserted = await sql`
    INSERT INTO stock_serials
      (stock_item_id, serial_number, status, condition, current_location_id,
       provenance, intake_carton_id, intake_by_staff_id, intake_at,
       intake_photo_key, intake_photo_url,
       received_date, received_reference)
    VALUES
      (${opts.stockItemId}, ${opts.serialNumber}, 'in_stock', 'new', ${opts.locationId},
       'field_intake', ${opts.cartonId}, ${opts.actorStaffId}, NOW(),
       ${opts.photoKey}, ${opts.photoUrl},
       NOW(), 'FIELD-INTAKE')
    ON CONFLICT (stock_item_id, serial_number) DO NOTHING
    RETURNING id
  `;
  } catch (err) {
    // The ON CONFLICT arm covers only (stock_item_id, serial_number). A photo
    // key already used for ANOTHER unit violates the separate unique index
    // from migration 520, and would otherwise escape as an uncaught throw —
    // reaching the storeman as a generic 500 rather than a refusal naming the
    // serial. Returning null drops it into unavailableSerials, which is the
    // ordinary 400 path.
    if ((err as { code?: string })?.code !== UNIQUE_VIOLATION) throw err;
    log.warn('label photo already used for another unit — refusing this serial', {
      serialNumber: opts.serialNumber, photoKey: opts.photoKey,
    }, 'pickings/_validation');
    return null;
  }
  const createdId = (inserted as Array<{ id: string }>)[0]?.id;
  if (createdId) {
    log.warn('serial taken into stock from a scanned carton the sheet does not list', {
      serialNumber: opts.serialNumber,
      stockItemId: opts.stockItemId,
      cartonId: opts.cartonId,
      locationId: opts.locationId,
      actorStaffId: opts.actorStaffId,
      // Which evidence admitted it: a carton listing, or a label photo.
      evidence: opts.cartonId ? 'carton' : opts.photoKey ? 'label-photo' : 'none',
    }, 'pickings/_validation');
    return createdId;
  }

  // Conflict: someone created it between the SELECT and here. Resolve theirs.
  const existing = await sql`
    SELECT id FROM stock_serials
    WHERE stock_item_id = ${opts.stockItemId}
      AND serial_number = ${opts.serialNumber}
      AND status IN ('available', 'in_stock')
    LIMIT 1
  `;
  return (existing as Array<{ id: string }>)[0]?.id ?? null;
}
