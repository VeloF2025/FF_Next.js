/**
 * GET /api/my/attendance-corrections-hints
 *
 * Returns the static hint catalogue (label, placeholder, hint,
 * minReasonChars) per AdjustmentKind so the /my portal dropdown + form
 * render correct prompts without hardcoding strings in the frontend.
 * The POST handler at /api/my/attendance-corrections enforces the same
 * `minReasonChars` per kind, so the UI and server agree by import.
 *
 * /my session required — the catalogue is internal UX copy, not a
 * public-facing taxonomy. Cached hard (public, s-maxage=3600) because
 * the payload is a static constant; a deploy busts the cache.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import {
  ADJUSTMENT_HINTS,
  ABSOLUTE_MIN_REASON_CHARS,
} from '@/modules/attendance/corrections/hintCatalogue';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export default withMySession(async (req, res, _session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    res.setHeader(
      'Cache-Control',
      'private, max-age=600, stale-while-revalidate=3600'
    );
    return apiResponse.success(res, {
      hints: ADJUSTMENT_HINTS,
      absoluteMinReasonChars: ABSOLUTE_MIN_REASON_CHARS,
    });
  } catch (err) {
    log.error('[my-corrections-hints] failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
});
