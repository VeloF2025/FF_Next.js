/**
 * GET /api/reporting/export-link?report=action-items|meetings&state=open
 *
 * Mint a short-lived signed URL for a CSV export. This route is the one that requires a
 * session; the URL it returns does not, which is what lets it be pasted into a browser or
 * a spreadsheet's web import.
 *
 * The caller's scope is signed into the URL — see lib/reporting/exportLinks.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { userHasPermission } from '@/lib/permissions';
import { resolveActionItemAccess } from '@/lib/actionItems/meetingAccess';
import {
  EXPORT_TTL_SECONDS,
  isExportable,
  signExportLink,
  type ExportReport,
} from '@/lib/reporting/exportLinks';
import { isConfigured } from '@/lib/photos/photoLinks';
import { EXPORT_MAX_ROWS, exportCountQuery } from '@/lib/reporting/exportQueries';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

/**
 * Hosts this deployment may point a signed link at.
 *
 * Taken from an allowlist rather than echoing the Host header, so a caller cannot aim
 * their own signed URL at a host they control. Mirrors pages/api/photos/manifest.ts.
 */
const ALLOWED_HOSTS = new Set(['app.fibreflow.app', 'dev.fibreflow.app']);

/**
 * The permission each report is gated on — the same key its aggregate route uses.
 *
 * Keyed by the report union rather than `string`, so the lookup is total: a new export
 * added to EXPORTABLE without a permission here is a compile error rather than an
 * `undefined` key that would be passed to the permission check at runtime.
 */
const REPORT_PERMISSION: Record<ExportReport, string> = {
  'action-items': 'dashboard.action-items',
  meetings: 'people.meetings',
};
const DEFAULT_BASE = 'https://app.fibreflow.app';

function baseUrl(req: NextApiRequest): string {
  const host = (req.headers.host ?? '').toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return ALLOWED_HOSTS.has(host) ? `https://${host}` : DEFAULT_BASE;
}

/** Only `state` is a filter today; kept explicit so the signed string is predictable. */
function filterString(req: NextApiRequest): string {
  const raw = req.query.state;
  const state = Array.isArray(raw) ? raw[0] : raw;
  return ['open', 'completed', 'all'].includes(state ?? '') ? (state as string) : 'open';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const rawReport = req.query.report;
  const report = Array.isArray(rawReport) ? rawReport[0] : rawReport;
  if (!isExportable(report)) {
    return apiResponse.badRequest(res, 'report must be action-items or meetings');
  }

  const user = (req as AuthenticatedNextApiRequest).user;
  const resolved = resolveActionItemAccess(user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);

  // Each report keeps ITS OWN key. Gating the whole route on one of them would let
  // someone holding `dashboard.action-items` but not `people.meetings` export meetings —
  // 31 users hold the meetings key against 84 for action items, so the two are not
  // interchangeable. Checked with the async helper because the sync `hasPermission` does
  // not consult user_permission_overrides.
  // withAuth returns the handler promise without awaiting it, so an unhandled rejection
  // here surfaces as a bare Next 500 with nothing logged. withPermission wraps its own
  // check for exactly this reason; doing the check inline means doing the wrapping too.
  const key = REPORT_PERMISSION[report];
  let permitted: boolean;
  try {
    permitted = await userHasPermission(user.id, key, 'view');
  } catch (error) {
    log.error('Export permission check failed', {
      module: 'reporting-export',
      key,
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, new Error('Could not verify your access.'));
  }
  if (!permitted) {
    return apiResponse.forbidden(res, `You do not have ${key} access.`);
  }

  // No secret means the feature is OFF, never "sign without a signature".
  if (!isConfigured()) {
    return apiResponse.internalError(res, new Error('Export links are not configured'));
  }

  const filters = filterString(req);
  const signed = signExportLink(report, resolved.access, filters);
  if (!signed) {
    return apiResponse.internalError(res, new Error('Export links are not configured'));
  }

  const url = new URL('/api/reporting/export', baseUrl(req));
  url.searchParams.set('report', report);
  url.searchParams.set('filters', filters);
  url.searchParams.set('email', resolved.access.email);
  url.searchParams.set('owner', resolved.access.isOwner ? '1' : '0');
  url.searchParams.set('exp', String(signed.exp));
  url.searchParams.set('sig', signed.sig);

  log.info('Minted report export link', {
    module: 'reporting-export',
    report,
    // The email is the SCOPE of the link, so who minted what is worth having in the log.
    email: resolved.access.email,
  });

  // Count now, so the caller learns the size BEFORE downloading — and so an MCP client,
  // which only ever sees this JSON and never the CSV's headers, can tell the truth about
  // truncation. Previously the only signal was a response header on the file itself,
  // which neither a browser download nor an agent observes.
  let rows: number | null = null;
  try {
    const counted = exportCountQuery(report, resolved.access, filters);
    rows = (await pool.query(counted.text, counted.params)).rows[0]?.n ?? null;
  } catch (error) {
    // A failed count must not block the link — the export itself still works, and the
    // CSV carries its own truncation notice. Report null rather than guessing a number.
    log.warn('Export row count failed; link issued without it', {
      module: 'reporting-export',
      report,
      error: (error as Error).message,
    });
  }

  res.setHeader('Cache-Control', 'private, no-store');
  return apiResponse.success(res, {
    url: url.toString(),
    expiresInSeconds: EXPORT_TTL_SECONDS,
    rows,
    truncated: rows === null ? null : rows > EXPORT_MAX_ROWS,
    maxRows: EXPORT_MAX_ROWS,
    scope: resolved.access.isOwner
      ? 'Every row in the report.'
      : 'Only the rows you can see — meetings you attended. Anyone holding this URL gets that same slice until it expires.',
  });
}

// The per-report permission is checked INSIDE the handler, because which key applies
// depends on which report was asked for and withPermission is fixed at wrap time.
export default withAuth(handler);
