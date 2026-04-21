/**
 * Demo Mode - Project Name Map
 *
 * Returns a stable mapping of real project names/codes to sanitized placeholders
 * ("Project 1", "Project 2", "P01", etc.), sorted alphabetically by real name.
 *
 * Used by the client-side fetch interceptor (see src/lib/demoMode.ts) to rewrite
 * project identifiers in API responses when the ff_demo_mode cookie is set.
 *
 * Safe by design: this endpoint only exposes data the caller can already see
 * via /api/projects. Requires auth.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { safeArrayQuery } from '../../../lib/safe-query';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'OPTIONS') {
    return apiResponse.handleOptions(req, res);
  }
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const sql = getSql();

    const rows = await safeArrayQuery(
      async () => sql`
        SELECT id, project_name, project_code
        FROM projects
        ORDER BY LOWER(project_name) ASC
      `,
      { logError: true }
    );

    const nameMap: Record<string, string> = {};
    const codeMap: Record<string, string> = {};
    const idMap: Record<string, { name: string; code: string }> = {};

    type ProjectRow = { id: string; project_name: string | null; project_code: string | null };
    ((rows as ProjectRow[] | null) || []).forEach((row, idx) => {
      const n = idx + 1;
      const fakeName = `Project ${n}`;
      const fakeCode = `P${String(n).padStart(2, '0')}`;

      if (row.project_name) nameMap[row.project_name] = fakeName;
      if (row.project_code) codeMap[row.project_code] = fakeCode;
      if (row.id) idMap[row.id] = { name: fakeName, code: fakeCode };
    });

    return apiResponse.success(res, { nameMap, codeMap, idMap });
  } catch (error) {
    log.error('Demo project-map error', { data: error }, 'demo/project-map.ts');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
