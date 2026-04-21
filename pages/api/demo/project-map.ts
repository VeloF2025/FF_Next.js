/**
 * Demo Mode - Name Map
 *
 * Returns stable mappings of real project and client names/codes to sanitized
 * placeholders ("Project 1", "P01", "Client 1", etc.), sorted alphabetically
 * by the real value so the same entity always maps to the same demo name
 * across screens.
 *
 * Used by the client-side fetch interceptor (see src/lib/demoMode.ts) to
 * rewrite identifiers in API responses while the ff_demo_mode cookie is set.
 *
 * Safe by design: this endpoint only exposes data the caller can already see
 * via /api/projects and /api/clients. Requires auth.
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

    const [projectRows, clientRows] = await Promise.all([
      safeArrayQuery(
        async () => sql`
          SELECT id, project_name, project_code
          FROM projects
          ORDER BY LOWER(project_name) ASC
        `,
        { logError: true }
      ),
      safeArrayQuery(
        async () => sql`
          SELECT id, company_name, contact_person
          FROM clients
          ORDER BY LOWER(company_name) ASC
        `,
        { logError: true }
      ),
    ]);

    const nameMap: Record<string, string> = {};
    const codeMap: Record<string, string> = {};
    const idMap: Record<string, { name: string; code: string }> = {};

    type ProjectRow = { id: string; project_name: string | null; project_code: string | null };
    ((projectRows as ProjectRow[] | null) || []).forEach((row, idx) => {
      const n = idx + 1;
      const fakeName = `Project ${n}`;
      const fakeCode = `P${String(n).padStart(2, '0')}`;

      if (row.project_name) nameMap[row.project_name] = fakeName;
      if (row.project_code) codeMap[row.project_code] = fakeCode;
      if (row.id) idMap[row.id] = { name: fakeName, code: fakeCode };
    });

    const clientNameMap: Record<string, string> = {};
    const clientContactMap: Record<string, string> = {};
    const clientIdMap: Record<string, { name: string }> = {};

    type ClientRow = { id: string; company_name: string | null; contact_person: string | null };
    ((clientRows as ClientRow[] | null) || []).forEach((row, idx) => {
      const n = idx + 1;
      const fakeName = `Client ${n}`;
      const fakeContact = `Contact ${n}`;

      if (row.company_name) clientNameMap[row.company_name] = fakeName;
      if (row.contact_person) clientContactMap[row.contact_person] = fakeContact;
      if (row.id) clientIdMap[row.id] = { name: fakeName };
    });

    return apiResponse.success(res, {
      nameMap,
      codeMap,
      idMap,
      clientNameMap,
      clientContactMap,
      clientIdMap,
    });
  } catch (error) {
    log.error('Demo project-map error', { data: error }, 'demo/project-map.ts');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
