/**
 * Serial-register drift API (PR-11) — read-only reconciliation drift detection.
 * GET /api/procurement/field-stock/serial-drift
 * (Named "serial-drift" to disambiguate from the unrelated serial-recon.ts WA/OES cross-ref.)
 *
 * Runs the 6 invariant checks server-side and returns a ReconciliationSummary.
 * A short in-memory cache + in-flight de-dup collapses concurrent opens and
 * refresh-spam into a single DB pass, since the page auto-runs on mount and
 * dev + prod share one Supabase DB.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';
import { getSerialReconciliationSummary } from '@/modules/procurement/field-stock/services/serialReconciliationService';
import type { ReconciliationSummary } from '@/types/field-stock';

const CACHE_TTL_MS = 60_000;

// Module-level cache is per-worker and resets on dev Fast Refresh. That is fine
// here: the payload is global register-health (no per-user data), `next start`
// runs a single worker, and the 60s TTL only bounds load on the shared DB.
let cache: { at: number; data: ReconciliationSummary } | null = null;
let inflight: Promise<ReconciliationSummary> | null = null;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return apiResponse.success(res, cache.data);
    }
    // Collapse concurrent requests onto a single DB pass.
    if (!inflight) {
      inflight = getSerialReconciliationSummary().finally(() => { inflight = null; });
    }
    const data = await inflight;
    cache = { at: Date.now(), data };
    return apiResponse.success(res, data);
  } catch (error) {
    log.error('Serial drift API error', { error }, 'field-stock/serial-drift');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('procurement.field-stock', 'view')(handler));
