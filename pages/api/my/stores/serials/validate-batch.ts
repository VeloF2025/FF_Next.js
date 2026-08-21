/**
 * POST /api/my/stores/serials/validate-batch — validate a scanned carton's
 * serials in one round-trip.
 *
 * Body: { serials, stockItemId, sourceLocationId?, scanPayload?: string }
 * Data: { results: BatchResult[], quantsWarning?: { serialsInStock, quantsOnHand } }
 *
 * Read-only. Status writes go through the domain endpoints (pickings, returns).
 * Gated to stores roles via requireStoresActor, same as the single-serial route.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { MAX_BOX_SERIALS } from '@/modules/field-stock-pwa/lib/boxScan';
import { runBatchValidation } from './_validateBatchCore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERIAL_SHAPE = /^[A-Z0-9]{8,20}$/;

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  const body = (req.body ?? {}) as {
    serials?: unknown;
    stockItemId?: unknown;
    sourceLocationId?: unknown;
    scanPayload?: unknown;
  };

  if (!Array.isArray(body.serials) || body.serials.length === 0) {
    return apiResponse.validationError(res, { serials: 'At least one serial is required' });
  }
  if (body.serials.length > MAX_BOX_SERIALS) {
    return apiResponse.validationError(res, {
      serials: `At most ${MAX_BOX_SERIALS} serials per request`,
    });
  }
  const serials = body.serials.map((s) => String(s).trim().toUpperCase());
  if (!serials.every((s) => SERIAL_SHAPE.test(s))) {
    return apiResponse.validationError(res, { serials: 'One or more serials are malformed' });
  }
  if (typeof body.stockItemId !== 'string' || !UUID.test(body.stockItemId)) {
    return apiResponse.validationError(res, { stockItemId: 'A valid stock item id is required' });
  }
  const sourceLocationId =
    typeof body.sourceLocationId === 'string' && UUID.test(body.sourceLocationId)
      ? body.sourceLocationId
      : null;

  try {
    // db-pool's exported query(text, params) IS the BatchQuerier shape.
    const data = await runBatchValidation(
      { query },
      {
        serials,
        stockItemId: body.stockItemId,
        sourceLocationId,
        // The RAW scan payload, not a claim about it. The core re-parses it
        // and only serials the payload actually lists may be taken into stock.
        // A non-string (absent, object, number) yields no eligible serials.
        scanPayload: typeof body.scanPayload === 'string' ? body.scanPayload : null,
      },
    );
    return apiResponse.success(res, data);
  } catch (error) {
    log.error('validate-batch failed', { error }, 'my/stores/serials/validate-batch');
    return apiResponse.internalError(res, error);
  }
});
