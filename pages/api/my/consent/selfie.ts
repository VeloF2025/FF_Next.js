/**
 * POST /api/my/consent/selfie — record or revoke POPIA biometric consent.
 *
 * Body: { action: 'grant' | 'revoke' }
 *
 * Grant:   sets selfie_consent_at = NOW(), bumps selfie_consent_version by 1.
 *          Required before clock-in/out; without it those endpoints return 403.
 * Revoke:  sets selfie_consent_at = NULL. Future clock-ins will be blocked,
 *          but an already-open entry can still be clocked out (the handler
 *          grandfathers revoked consent and logs a `manual_override` exception
 *          — covered by migration 310 + PR3).
 *
 * This endpoint is the minimal companion to PR3's consent-state read. The
 * full POPIA workflow (access log for admin views, 90-day retention cron,
 * privacy notice acceptance) lands in PR7.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';

export const config = {
  api: { bodyParser: { sizeLimit: '1kb' } },
};

interface ConsentBody {
  action?: 'grant' | 'revoke';
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const action = (req.body as ConsentBody | null)?.action;
  if (action !== 'grant' && action !== 'revoke') {
    return apiResponse.badRequest(res, "action must be 'grant' or 'revoke'");
  }

  try {
    if (action === 'grant') {
      const rows = await sql<{ version: number }>`
        UPDATE attendance_credentials
        SET
          selfie_consent_at      = NOW(),
          selfie_consent_version = COALESCE(selfie_consent_version, 0) + 1,
          updated_at             = NOW()
        WHERE staff_id = ${session.staffId}
        RETURNING selfie_consent_version AS version
      `;
      if (rows.length === 0) {
        // No attendance_credentials row for this staff. Onboarding is
        // incomplete — without a row, there's nowhere to anchor the consent
        // timestamp, and the caller would otherwise loop forever on the
        // clock-in screen (PR3 clock-in returns 403 consent_missing for the
        // same no-row state). Surface it explicitly so the UI can route the
        // user to /my/onboard.
        log.error('[my-consent-selfie] attendance_credentials row missing — grant no-op', {
          staffId: session.staffId,
        });
        return apiResponse.notFound(res, 'attendance_credentials', session.staffId);
      }
      const version = rows[0]!.version;
      log.info('[my-consent-selfie] granted', { staffId: session.staffId, version });
      return apiResponse.success(res, { ok: true, action, version });
    }

    const revokedRows = await sql<{ staff_id: string }>`
      UPDATE attendance_credentials
      SET selfie_consent_at = NULL, updated_at = NOW()
      WHERE staff_id = ${session.staffId}
      RETURNING staff_id
    `;
    if (revokedRows.length === 0) {
      log.error('[my-consent-selfie] attendance_credentials row missing — revoke no-op', {
        staffId: session.staffId,
      });
      return apiResponse.notFound(res, 'attendance_credentials', session.staffId);
    }
    log.warn('[my-consent-selfie] revoked', { staffId: session.staffId });
    return apiResponse.success(res, { ok: true, action });
  } catch (err) {
    log.error('[my-consent-selfie] unexpected error', {
      staffId: session.staffId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
});
