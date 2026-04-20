/**
 * GET /api/staff/attendance-selfie?entryId=<uuid>&kind=in|out
 *
 * Admin access to a specific attendance selfie. Writes the POPIA access-log
 * row (`attendance_selfie_access_log`) BEFORE returning, so we record the
 * intent-to-view even if the downstream fetch fails. Returns the relative
 * `/storage/...` URL; the nginx proxy serves the bytes.
 *
 * RBAC: `people.staff.attendance.manage`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withAuth, withPermission, AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { AuditWriteError, logSelfieAccess } from '@/modules/attendance/portal/retentionUtils';

interface EntryRow extends Record<string, unknown> {
  id: string;
  selfie_in_url: string | null;
  selfie_out_url: string | null;
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    // Empty string (e.g. header is a bare `,`) is meaningless for audit
    // purposes — coerce to null rather than storing `''`.
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const entryId = typeof req.query.entryId === 'string' ? req.query.entryId.trim() : '';
  const kindRaw = typeof req.query.kind === 'string' ? req.query.kind : '';
  const context = typeof req.query.context === 'string' ? req.query.context : null;

  if (!/^[0-9a-f-]{36}$/i.test(entryId)) {
    return apiResponse.badRequest(res, 'entryId must be a UUID');
  }
  if (kindRaw !== 'in' && kindRaw !== 'out') {
    return apiResponse.badRequest(res, "kind must be 'in' or 'out'");
  }
  const kind = kindRaw;
  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const rows = await sql<EntryRow>`
      SELECT id, selfie_in_url, selfie_out_url
      FROM attendance_entries
      WHERE id = ${entryId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return apiResponse.notFound(res, 'attendance_entry', entryId);
    }

    const url = kind === 'in' ? row.selfie_in_url : row.selfie_out_url;
    if (!url) {
      // Row exists but URL is null — either never uploaded or retention-
      // swept. We cannot currently tell these apart without a
      // `selfie_{in,out}_deleted_at` column (flagged to product). Return
      // 404 with an explicit `reason: 'unavailable'` so the admin UI can
      // show a clean "unavailable" message distinct from a mistyped id.
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Selfie unavailable.',
          details: { reason: 'unavailable' },
        },
      });
    }

    // Write the audit row BEFORE returning the URL. A failure here MUST
    // block the response — a POPIA-sensitive view without a successful
    // audit write is exactly the silent compliance gap POPIA s17 is meant
    // to prevent. 503 with a specific code lets ops investigate rather
    // than hiding the miss behind a 200.
    try {
      await logSelfieAccess({
        entryId,
        selfieType: kind,
        viewedBy: authReq.user.id,
        ipAddress: clientIp(req),
        context,
      });
    } catch (auditErr) {
      if (auditErr instanceof AuditWriteError) {
        log.error('[staff-attendance-selfie] refusing to serve — audit write failed', {
          entryId, kind, viewedBy: authReq.user.id,
        });
        return apiResponse.error(
          res,
          ErrorCode.SERVICE_UNAVAILABLE,
          'Compliance audit write failed. The selfie cannot be served right now — try again or contact ops.',
          { reason: 'audit_write_failed' }
        );
      }
      throw auditErr;
    }

    return apiResponse.success(res, { entryId, kind, url });
  } catch (err) {
    log.error('[staff-attendance-selfie] unexpected error', {
      entryId,
      kind,
      viewedBy: authReq.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.manage', 'view')(handler));
