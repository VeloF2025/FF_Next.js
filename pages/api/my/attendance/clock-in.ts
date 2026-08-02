/** POST /api/my/attendance/clock-in — authenticated request adapter. */

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { isValidLatLon } from '@/lib/geo';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { executeClockInCommand } from '@/modules/attendance/portal/clockInCommand';

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

interface ClockInBody {
  lat?: number;
  lon?: number;
  accuracy_m?: number;
  client_occurred_at?: string;
  selfie_base64?: string;
  device_fingerprint?: string;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as ClockInBody;
  if (!isValidLatLon({ lat: body.lat, lon: body.lon })) {
    return apiResponse.badRequest(res, 'lat and lon are required and must be valid coordinates');
  }
  if (typeof body.client_occurred_at !== 'string' || Number.isNaN(Date.parse(body.client_occurred_at))) {
    return apiResponse.badRequest(res, 'client_occurred_at must be a valid ISO timestamp');
  }
  if (typeof body.selfie_base64 !== 'string' || body.selfie_base64.length < 100) {
    return apiResponse.badRequest(res, 'selfie_base64 is required');
  }

  try {
    const result = await executeClockInCommand({
      staffId: session.staffId,
      lat: body.lat as number,
      lon: body.lon as number,
      accuracyM:
        typeof body.accuracy_m === 'number' && Number.isFinite(body.accuracy_m)
          ? body.accuracy_m
          : null,
      clientOccurredAt: new Date(body.client_occurred_at),
      selfieBase64: body.selfie_base64,
      deviceFingerprint:
        typeof body.device_fingerprint === 'string'
          ? body.device_fingerprint.slice(0, 256)
          : null,
      deviceUserAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    });
    if (result.ok) return apiResponse.success(res, result.data);

    const code = result.kind === 'bad_request'
      ? ErrorCode.BAD_REQUEST
      : result.kind === 'forbidden'
        ? ErrorCode.FORBIDDEN
        : ErrorCode.CONFLICT;
    return apiResponse.error(res, code, result.message, result.details);
  } catch (error) {
    log.error('[my-clock-in] command failed', {
      staffId: session.staffId,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiResponse.internalError(res, error);
  }
});
