/**
 * Shared picking-create core.
 *
 * Extracted from pickings/index.ts so both auth tiers can reuse it:
 *   - the main withAuth route resolves createdByStaffId from req.user.id → staff
 *   - the /my stores PWA route (withMySession) passes session.staffId directly
 *
 * createdByStaffId is the CREATOR (the stores person issuing), nullable — admin/
 * system users without a staff row write NULL (matches the partial-index
 * predicate `WHERE created_by_staff_id IS NOT NULL` from migration 371).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  checkPendingValueCap,
  PENDING_TECH_VALUE_CAP_ZAR,
} from '@/modules/field-stock-pwa/lib/stockValueGuard';
import {
  validateFieldDefaultDestination,
  validateSerialsAvailable,
  type PickingLine,
} from './_validation';

const sql = neon(process.env.DATABASE_URL!);

export async function createPicking(
  req: NextApiRequest,
  res: NextApiResponse,
  createdByStaffId: string | null,
) {
  try {
    const {
      pickingType, sourceLocationId, destinationLocationId,
      projectId, jobReference, jobType,
      contractorId, contractorName, teamName,
      technicianId, technicianName, scheduledDate,
      notes, lines,
    } = req.body;

    if (!sourceLocationId) {
      return apiResponse.validationError(res, { sourceLocationId: 'Source location is required' });
    }
    if (!destinationLocationId) {
      return apiResponse.validationError(res, { destinationLocationId: 'Destination location is required' });
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return apiResponse.validationError(res, { lines: 'At least one picking line is required' });
    }

    // ── Non-serial issue lines: proof photo + positive quantity (spec 2026-06-11) ──
    // A line with no serialIds is a quantity-based issue (lot/quantity/none
    // tracking). One proof photo per picking is mandatory for these; serial
    // pickings carry the serials themselves as evidence.
    const { proofPhotoKey, proofPhotoUrl } = req.body as {
      proofPhotoKey?: string; proofPhotoUrl?: string;
    };

    // Stored-XSS hardening: client-supplied proofPhotoUrl is persisted and may
    // later be rendered as <img src>; only relative VF Storage paths are allowed.
    if (proofPhotoUrl && !proofPhotoUrl.startsWith('/storage/')) {
      return apiResponse.badRequest(res, 'proofPhotoUrl must be a VF Storage /storage/ path', {
        code: 'INVALID_PROOF_PHOTO_URL',
      });
    }

    const nonSerialLines = (lines as PickingLine[]).filter(
      (l) => !Array.isArray(l.serialIds) || l.serialIds.length === 0,
    );
    if ((pickingType ?? null) === 'issue' && nonSerialLines.length > 0) {
      if (!proofPhotoKey) {
        return apiResponse.badRequest(
          res,
          'A proof photo is required when issuing non-serial stock',
          { proofPhotoKey: 'A proof photo is required when issuing non-serial stock' },
        );
      }
      const badQty = nonSerialLines.find(
        (l) => typeof l.plannedQuantity !== 'number' || !(l.plannedQuantity > 0),
      );
      if (badQty) {
        return apiResponse.badRequest(
          res,
          'Quantity must be greater than zero for non-serial lines',
          { plannedQuantity: 'Quantity must be greater than zero for non-serial lines' },
        );
      }
    }

    // ── H5: Require technicianId for FIELD-DEFAULT destination ───────────────
    // Extracted to _validation.ts; see validateFieldDefaultDestination for rationale.
    const fieldDefaultCheck = await validateFieldDefaultDestination({
      destinationLocationId,
      technicianId,
    });
    if (!fieldDefaultCheck.ok) {
      return res.status(fieldDefaultCheck.status).json(fieldDefaultCheck.body);
    }

    // ── Pending-technician R5,000 stock-value cap (Task 2.6) ─────────────────
    // Server-side enforcement: a malicious or buggy client could bypass the
    // client-side guard in SignAndSubmitStep. We independently verify here,
    // BEFORE any INSERT, so no partial state is written on a cap breach.
    let resolvedTechnicianName: string | null = technicianName || null;
    if (technicianId) {
      const techResults = await sql`
        SELECT account_status, first_name, last_name FROM staff WHERE id = ${technicianId} LIMIT 1
      `;
      const techRow = (techResults as Array<{ account_status: string; first_name: string | null; last_name: string | null }>)[0];

      // Resolve the technician's display name server-side when the client did
      // not send one (the stores PWA sends only technicianId). Without this the
      // holder created at process time falls back to the literal 'technician',
      // which renders the Accountability report nameless.
      if (!resolvedTechnicianName && techRow) {
        resolvedTechnicianName =
          `${techRow.first_name ?? ''} ${techRow.last_name ?? ''}`.trim() || null;
      }

      // Only enforce cap for pending technicians. Active/suspended fall through.
      if (techRow?.account_status === 'pending') {
        // Resolve standard_cost for each line — fail-closed on null.
        const valueLines: Array<{ unitValueZar: number; quantity: number }> = [];
        for (const line of lines as PickingLine[]) {
          const itemResults = await sql`
            SELECT standard_cost FROM stock_items WHERE id = ${line.stockItemId} LIMIT 1
          `;
          const itemRow = (itemResults as Array<{ standard_cost: number | null }>)[0];
          if (itemRow?.standard_cost == null) {
            // Cannot enforce cap if pricing is missing — block the issue.
            return apiResponse.error(
              res,
              ErrorCode.BAD_REQUEST,
              `Unit value for stock item ${line.stockItemId} is not set. ` +
                'The procurement team must set standard_cost before this item can be issued to a pending technician.',
              { code: 'PENDING_TECH_VALUE_UNKNOWN', stockItemId: line.stockItemId },
            );
          }
          // Quantity: use plannedQuantity; fall back to serialIds count if present.
          const qty =
            line.plannedQuantity ??
            (Array.isArray(line.serialIds) ? line.serialIds.length : 0);
          valueLines.push({ unitValueZar: itemRow.standard_cost, quantity: qty });
        }

        const { over, totalZar, capZar } = checkPendingValueCap(valueLines, 'pending');
        if (over) {
          return apiResponse.error(
            res,
            ErrorCode.BAD_REQUEST,
            `Issue value of R${totalZar.toFixed(2)} exceeds the R${PENDING_TECH_VALUE_CAP_ZAR} ` +
              'limit for technicians with a pending account. An admin must approve the account first.',
            { code: 'PENDING_TECH_VALUE_CAP_EXCEEDED', totalZar, capZar },
          );
        }
      }
    }
    // ── End pending-tech cap check ────────────────────────────────────────────

    // ── H7: Server-side serial availability check + serial_number → UUID resolution
    // Extracted to _validation.ts; see validateSerialsAvailable for rationale.
    // The validator also resolves each serial_number to its stock_serials.id UUID
    // so the INSERT into stock_picking_lines.serial_ids (uuid[]) receives the
    // correct type — not the human-readable label string from the client.
    const serialCheck = await validateSerialsAvailable(sql, lines as PickingLine[]);
    if (!serialCheck.ok) {
      return res.status(serialCheck.status).json(serialCheck.body);
    }
    const resolvedSerialIds = serialCheck.resolvedSerialIds ?? new Map<string, string>();
    // ── End serial availability check ────────────────────────────────────────

    // Generate picking number
    const countResult = await sql`SELECT COUNT(*) as count FROM stock_pickings`;
    const count = countResult[0] ? Number(countResult[0].count || 0) : 0;
    const pickingNumber = `PCK-${String(count + 1).padStart(6, '0')}`;

    // Create picking header
    const pickingResult = await sql`
      INSERT INTO stock_pickings (
        picking_number, picking_type,
        source_location_id, destination_location_id,
        project_id, job_reference, job_type,
        contractor_id, contractor_name, team_name,
        technician_id, technician_name,
        scheduled_date, status, notes,
        created_by_staff_id,
        proof_photo_key, proof_photo_url
      ) VALUES (
        ${pickingNumber}, ${pickingType || null},
        ${sourceLocationId}, ${destinationLocationId},
        ${projectId || null}, ${jobReference || null}, ${jobType || null},
        ${contractorId || null}, ${contractorName || null}, ${teamName || null},
        ${technicianId || null}, ${resolvedTechnicianName},
        ${scheduledDate || null}, 'draft', ${notes || null},
        ${createdByStaffId},
        ${proofPhotoKey || null}, ${proofPhotoUrl || null}
      )
      RETURNING *
    `;

    const pickingRecord = pickingResult[0];
    if (!pickingRecord) {
      return apiResponse.internalError(res, new Error('Failed to create picking'));
    }

    const pickingId = pickingRecord.id as string;

    // Insert lines
    // serial_ids on stock_picking_lines is uuid[] — the client sends serial_number
    // strings, which validateSerialsAvailable resolved to stock_serials.id UUIDs.
    // Pass a JS string[] (not JSON.stringify); node-postgres serialises it correctly
    // as a Postgres array literal for uuid[] columns.
    for (const line of lines as PickingLine[]) {
      const uuidArray: string[] | null = Array.isArray(line.serialIds) && line.serialIds.length > 0
        ? line.serialIds
            .map((sn) => resolvedSerialIds.get(sn))
            .filter((u): u is string => Boolean(u))
        : null;

      // Snapshot the item's standard_cost onto the line at issue time. The
      // process step passes line.unit_cost into custody (stock_custody.total_value
      // and field_stock_movements.unit_cost) — without this stamp every holder's
      // held_value in the Accountability report reads R0.
      const costRows = await sql`
        SELECT standard_cost FROM stock_items WHERE id = ${line.stockItemId} LIMIT 1
      `;
      const unitCost = (costRows as Array<{ standard_cost: number | null }>)[0]?.standard_cost ?? null;

      await sql`
        INSERT INTO stock_picking_lines (
          picking_id, stock_item_id, planned_quantity,
          serial_ids, lot_number, notes, status, unit_cost
        ) VALUES (
          ${pickingId}, ${line.stockItemId}, ${line.plannedQuantity},
          ${uuidArray},
          ${line.lotNumber || null}, ${line.notes || null}, 'pending', ${unitCost}
        )
      `;
    }

    // Refetch with full joins and lines
    const result = await sql`
      SELECT p.*, sl_src.name as source_location_name, sl_src.code as source_location_code,
        sl_dest.name as destination_location_name, sl_dest.code as destination_location_code,
        (SELECT json_agg(json_build_object('id',pl.id,'stock_item_id',pl.stock_item_id,
          'planned_quantity',pl.planned_quantity,'actual_quantity',pl.actual_quantity,
          'serial_ids',pl.serial_ids,'status',pl.status,'notes',pl.notes,
          'item_name',si.name,'item_code',si.item_code))
         FROM stock_picking_lines pl LEFT JOIN stock_items si ON si.id = pl.stock_item_id
         WHERE pl.picking_id = p.id) as lines
      FROM stock_pickings p
      LEFT JOIN stock_locations sl_src ON sl_src.id = p.source_location_id
      LEFT JOIN stock_locations sl_dest ON sl_dest.id = p.destination_location_id
      WHERE p.id = ${pickingId}
    `;

    log.info('Stock picking created', { pickingNumber, pickingId, lineCount: lines.length }, 'field-stock');
    res.status(201);
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error creating picking', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}
