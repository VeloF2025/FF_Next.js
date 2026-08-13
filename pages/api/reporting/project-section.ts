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
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { userHasPermission } from '@/lib/permissions';
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
    // The only section carrying financial figures, so the only one that asks a second
    // question about the caller.
    shape: (r: unknown, canSeeProcurement: boolean) =>
      shapeDeliverySection(r as DeliverySectionRow, canSeeProcurement),
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
  // hasOwnProperty, NOT `in`: `in` walks the prototype chain, so `constructor`,
  // `__proto__`, `valueOf` and `toString` all pass an allowlist written with it. They
  // then destructure to undefined and throw, turning a bad parameter into a 500 and a
  // log line per request instead of the 400 this is meant to return.
  if (!Object.prototype.hasOwnProperty.call(SECTIONS, section)) {
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

    // Purchase-order totals and BOQ values are financial data, and this repo already
    // gates them separately: contractor and storeman are explicitly denied `procurement`
    // view and technician and viewer hold no row at all, yet all four hold the `projects`
    // view that gates this route. Asked per request rather than assumed from the route's
    // own gate, and the section is trimmed rather than refused — the activation half is
    // legitimately theirs.
    const user = (req as AuthenticatedNextApiRequest).user;
    const canSeeProcurement =
      section === 'delivery'
        ? await userHasPermission(user.id, 'procurement', 'view')
        : true;

    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(res, { section, ...shape(row, canSeeProcurement) });
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
