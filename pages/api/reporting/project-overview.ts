/**
 * GET /api/reporting/project-overview?project=Etwatwa
 *
 * One project's actuals in a payload small enough to answer a question with, rather than
 * a table to page through. Built for the MCP connector, whose responses are capped at
 * 15,000 characters — listing 21 projects is already 22 kB, so a reporting surface has to
 * aggregate server-side or it cannot answer anything at all.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { overviewQuery, shapeOverview, type OverviewRow } from '@/lib/reporting/projectOverview';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const raw = req.query.project;
  const project = typeof raw === 'string' ? raw.trim() : '';
  if (!project) return apiResponse.badRequest(res, 'project is required (name or UUID)');

  try {
    const { sql, params } = overviewQuery(project);
    const result = await pool.query<OverviewRow>(sql, params as unknown[]);

    const row = result.rows[0];
    if (!row) return apiResponse.notFound(res, 'Project', project);

    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(res, shapeOverview(row));
  } catch (error) {
    log.error(
      'Project overview failed',
      { module: 'reporting-overview', project, error: (error as Error).message },
      'reporting-overview',
    );
    return apiResponse.internalError(res, new Error('Project overview failed'));
  }
}

// Project reporting reads across build, QA, activations, snags and procurement, but every
// figure is an aggregate count — no photo bytes, no financial values, no personal data.
// `projects.view` is the permission that already gates seeing a project at all.
export default withAuth(withPermission('projects.view')(handler));
