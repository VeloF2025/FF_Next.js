/**
 * GET /api/reporting/project-section?project=Etwatwa&section=build
 *
 * One route, several sections — the same shape as /api/qfield/project-stats, which is the
 * curated-reporting pattern already proven in this repo. Each section aggregates
 * server-side because the MCP connector caps responses at 15,000 characters and raw rows
 * do not survive that.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { buildSectionQuery, shapeBuildSection, type BuildSectionRow } from '@/lib/reporting/buildSection';
import {
  deliverySectionQuery,
  shapeDeliverySection,
  type DeliverySectionRow,
} from '@/lib/reporting/deliverySection';
import {
  qualitySectionQuery,
  shapeQualitySection,
  type QualitySectionRow,
} from '@/lib/reporting/qualitySection';

const SECTIONS = {
  build: {
    query: buildSectionQuery,
    shape: (r: unknown) => shapeBuildSection(r as BuildSectionRow),
  },
  quality: {
    query: qualitySectionQuery,
    shape: (r: unknown) => shapeQualitySection(r as QualitySectionRow),
  },
  delivery: {
    query: deliverySectionQuery,
    shape: (r: unknown) => shapeDeliverySection(r as DeliverySectionRow),
  },
} as const;

type SectionName = keyof typeof SECTIONS;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const rawProject = req.query.project;
  const project = typeof rawProject === 'string' ? rawProject.trim() : '';
  if (!project) return apiResponse.badRequest(res, 'project is required (name or UUID)');

  const rawSection = req.query.section;
  const section = (typeof rawSection === 'string' ? rawSection : 'build') as SectionName;
  if (!(section in SECTIONS)) {
    return apiResponse.badRequest(
      res,
      `section must be one of ${Object.keys(SECTIONS).join(', ')} — got "${rawSection}"`,
    );
  }

  try {
    const { query, shape } = SECTIONS[section];
    const { sql, params } = query(project);
    const result = await pool.query(sql, params as unknown[]);

    const row = result.rows[0];
    if (!row) return apiResponse.notFound(res, 'Project', project);

    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(res, { section, ...shape(row) });
  } catch (error) {
    log.error(
      'Project section failed',
      { module: 'reporting-section', project, section, error: (error as Error).message },
      'reporting-section',
    );
    return apiResponse.internalError(res, new Error('Project section failed'));
  }
}

// KEY then ACTION. `projects.view` is not a permission key — there is no such row in
// access_permissions, and withPermission would deny every non-super-admin caller.
export default withAuth(withPermission('projects', 'view')(handler));
