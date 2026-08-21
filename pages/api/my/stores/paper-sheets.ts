/**
 * POST /api/my/stores/paper-sheets — record a historical paper install sheet
 * whose ONT serials were SCANNED off the stickers.
 *
 * The paper is the "HOME DROP AND ACTIVATION - EQUIPMENT ALLOCATION FORM".
 * Its ONT column is barcode stickers, so scanning beats the VLM path outright:
 * on the 21 sheets captured in May 2026 the VLM read 190 of 224 ONT serials.
 *
 * WHAT THIS DOES NOT DO: it does not touch stock_serials. A serial on an old
 * sheet is a claim about the past, not a receipt — the ONT left the shelf
 * months ago. Measured on those same sheets, 72% of serials are already
 * recorded and need nothing at all. Back-dating stock movement is
 * irreversible and what the unknown serials should become has not been
 * decided, so this captures the paper and reports what it found.
 *
 * The report is the point: it names the serials the system still believes are
 * on the shelf while the paper says they were handed out.
 *
 * Gated to stores roles — it names technicians.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor, type StoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { createSheet } from '@/modules/data-sync/services/eodSheetService';
import { summarisePaperSheet, type PaperSheetSerial } from '@/modules/data-sync/lib/paperSheetVerdict';
import { createHash } from 'node:crypto';

/** Postgres unique-violation. The duplicate answer, not an error. */
const UNIQUE_VIOLATION = '23505';

/** What identifies a paper sheet: its date and its exact set of serials. */
function contentHashFor(sheetDate: string, sortedSerials: string[]): string {
  return createHash('sha256')
    .update(`${sheetDate}\u0000${sortedSerials.join(',')}`)
    .digest('hex');
}

/** One page of the form holds 10 rows; allow a generous multiple, not unlimited. */
const MAX_SERIALS_PER_SHEET = 60;
const SERIAL_SHAPE = /^[A-Z0-9]{8,20}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function handlePost(req: NextApiRequest, res: NextApiResponse, actor: StoresActor) {
  const body = (req.body ?? {}) as {
    sheetDate?: unknown;
    technicianId?: unknown;
    technicianName?: unknown;
    serials?: unknown;
  };

  // The sheet's OWN date, not today. A record of a past document that carries
  // today's date misstates when the stock actually moved.
  if (typeof body.sheetDate !== 'string' || !ISO_DATE.test(body.sheetDate)) {
    return apiResponse.validationError(res, {
      sheetDate: "The sheet's own date is required (YYYY-MM-DD)",
    });
  }
  if (body.sheetDate > new Date().toISOString().slice(0, 10)) {
    return apiResponse.validationError(res, { sheetDate: 'A sheet cannot be dated in the future' });
  }
  if (!Array.isArray(body.serials) || body.serials.length === 0) {
    return apiResponse.validationError(res, { serials: 'Scan at least one serial' });
  }
  if (body.serials.length > MAX_SERIALS_PER_SHEET) {
    return apiResponse.validationError(res, {
      serials: `At most ${MAX_SERIALS_PER_SHEET} serials per sheet`,
    });
  }

  const serials = [...new Set(
    body.serials.map((s) => String(s).trim().toUpperCase()).filter(Boolean),
  )];
  if (!serials.every((s) => SERIAL_SHAPE.test(s))) {
    return apiResponse.validationError(res, { serials: 'One or more serials are malformed' });
  }

  // What stock currently believes about each scanned serial.
  const rows = await sql`
    SELECT serial_number, status FROM stock_serials
    WHERE serial_number = ANY(${serials}::text[])
  `;
  const statusBySerial = new Map(
    (rows as Array<{ serial_number: string; status: string }>)
      .map((r) => [r.serial_number, r.status]),
  );
  const classified: PaperSheetSerial[] = serials.map((serialNumber) => ({
    serialNumber,
    status: statusBySerial.get(serialNumber) ?? null,
  }));
  const summary = summarisePaperSheet(classified);

  // Same paper, recorded twice. photo_hash's unique index is PARTIAL
  // (WHERE photo_hash IS NOT NULL), and this path has no photo, so nothing
  // stopped a double-tap or a re-scan next week — and every duplicate
  // double-counts into the reconciliation stats.
  //
  // The check below is a fast path for the friendly case. It CANNOT be the
  // guarantee: two concurrent submissions (a flaky-network retry firing twice,
  // the likeliest real cause) can both read "none" and both insert. The unique
  // index from migration 517 is what actually closes it, and the insert below
  // treats its violation as the answer.
  const contentHash = contentHashFor(body.sheetDate, [...serials].sort());
  const existing = await sql`
    SELECT id FROM eod_install_sheets WHERE content_hash = ${contentHash} LIMIT 1
  `;
  const duplicateOf = (existing as Array<{ id: string }>)[0]?.id ?? null;
  if (duplicateOf) {
    // Report what it found anyway — the storeman still wants the answer — but
    // do not add a second copy of the sheet.
    log.info('paper sheet already recorded; returning the existing one', {
      sheetId: duplicateOf, sheetDate: body.sheetDate, serials: serials.length,
    }, 'my/stores/paper-sheets');
    return apiResponse.success(
      res,
      // NOT `alreadyRecorded` — that name is already a per-serial count in the
      // summary, and spreading it after would silently overwrite the flag.
      { sheetId: duplicateOf, duplicateSheet: true, ...summary },
      'This sheet was already recorded',
    );
  }

  let sheet: { id: string };
  try {
    sheet = await createSheet({
    sheetDate: body.sheetDate,
    source: 'scanned',
    contentHash,
    velocityRepName: null,
    velocityRepId: null,
    technicianName: typeof body.technicianName === 'string' ? body.technicianName : null,
    technicianId: typeof body.technicianId === 'string' ? body.technicianId : null,
    // No photograph on this path — the serials came off the stickers. The
    // column is nullable, and photo_hash is what dedupes the VLM path.
    photoUrl: null,
    photoHash: null,
    vlmRawJson: null,
    uploadedBy: actor.staffId,
    entries: serials.map((ontSerial, i) => ({
      rowNumber: i + 1,
      ontSerial,
      // Only the ONT column is scannable. Gizzu serials, DR numbers and
      // addresses on this form are handwritten and are deliberately not
      // captured here.
      gizzuSerial: null,
      drNumber: null,
      gizzuDrNumber: null,
      ponNumber: null,
      address: null,
    })),
  });
  } catch (err) {
    // Lost the race: another submission inserted the same sheet between our
    // check and our insert. That is the same outcome, reached the hard way.
    if ((err as { code?: string })?.code !== UNIQUE_VIOLATION) throw err;
    const raced = await sql`
      SELECT id FROM eod_install_sheets WHERE content_hash = ${contentHash} LIMIT 1
    `;
    const racedId = (raced as Array<{ id: string }>)[0]?.id ?? null;
    log.info('paper sheet lost the insert race; returning the winner', {
      sheetId: racedId, sheetDate: body.sheetDate,
    }, 'my/stores/paper-sheets');
    return apiResponse.success(
      res,
      { sheetId: racedId, duplicateSheet: true, ...summary },
      'This sheet was already recorded',
    );
  }

  if (summary.contradictsStock > 0) {
    log.warn('paper sheet contradicts stock — serials believed on the shelf were handed out', {
      sheetId: sheet.id,
      sheetDate: body.sheetDate,
      count: summary.contradictsStock,
      serials: summary.serials
        .filter((s) => s.verdict === 'contradicts-stock')
        .map((s) => s.serialNumber),
    }, 'my/stores/paper-sheets');
  }

  return apiResponse.created(res, { sheetId: sheet.id, ...summary }, 'Paper sheet recorded');
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
  return handlePost(req, res, actor);
});
