/**
 * GET /api/snags/reports-scope-pdf?id=<uuid>
 *
 * 302 redirect to the stored pdf_url for a previously generated scope
 * snag report.  The PDF itself lives in VF Storage (immutable snapshot);
 * this route just gates it behind the RBAC permission and redirects.
 *
 * Permission: construction-qa.snags.reports
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const id = req.query.id;
  if (typeof id !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'id query parameter is required');
  }

  const rows = (await sql`
    SELECT pdf_url, report_number
    FROM   snag_reports
    WHERE  id = ${id}
      AND  source = 'scope'
  ` as unknown) as Array<{ pdf_url: string | null; report_number: string }>;

  if (rows.length === 0 || !rows[0]!.pdf_url) {
    return apiResponse.notFound(res, 'Scope report', id);
  }

  res.redirect(302, rows[0]!.pdf_url);
}

export default withAuth(
  withPermission('construction-qa.snags.reports', 'view')(handler),
);
