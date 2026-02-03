/**
 * Projects Search API for Pipeline Linking
 * GET /api/projects/search-for-linking - Search projects for linking to pipeline
 *
 * Query params:
 * - q: Search query (matches project name, project code)
 * - pipeline_project_id: Pipeline project ID to exclude already-linked projects
 * - limit: Max results (default 20)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const {
      q,
      pipeline_project_id,
      limit = '20',
    } = req.query;

    const searchQuery = typeof q === 'string' ? q.trim() : '';
    const pipelineProjectId = typeof pipeline_project_id === 'string' ? pipeline_project_id : null;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);

    // Get already linked project IDs for this pipeline project
    let linkedProjectIds: string[] = [];
    if (pipelineProjectId) {
      const linkedResult = await sql`
        SELECT project_id FROM project_pipeline_links
        WHERE pipeline_project_id = ${pipelineProjectId}
      `;
      linkedProjectIds = linkedResult.map((r: { project_id: string }) => r.project_id);
    }

    // Build query based on filters
    let results;

    if (searchQuery && linkedProjectIds.length > 0) {
      results = await sql`
        SELECT
          p.id,
          p.project_code,
          p.project_name,
          p.status,
          p.location,
          p.client_id,
          c.name as client_name,
          p.pipeline_project_id as existing_pipeline_id
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id NOT IN ${sql(linkedProjectIds)}
          AND (
            p.project_name ILIKE ${'%' + searchQuery + '%'}
            OR p.project_code ILIKE ${'%' + searchQuery + '%'}
          )
        ORDER BY p.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (searchQuery) {
      results = await sql`
        SELECT
          p.id,
          p.project_code,
          p.project_name,
          p.status,
          p.location,
          p.client_id,
          c.name as client_name,
          p.pipeline_project_id as existing_pipeline_id
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.project_name ILIKE ${'%' + searchQuery + '%'}
          OR p.project_code ILIKE ${'%' + searchQuery + '%'}
        ORDER BY p.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (linkedProjectIds.length > 0) {
      results = await sql`
        SELECT
          p.id,
          p.project_code,
          p.project_name,
          p.status,
          p.location,
          p.client_id,
          c.name as client_name,
          p.pipeline_project_id as existing_pipeline_id
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id NOT IN ${sql(linkedProjectIds)}
        ORDER BY p.project_name ASC
        LIMIT ${limitNum}
      `;
    } else {
      results = await sql`
        SELECT
          p.id,
          p.project_code,
          p.project_name,
          p.status,
          p.location,
          p.client_id,
          c.name as client_name,
          p.pipeline_project_id as existing_pipeline_id
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        ORDER BY p.project_name ASC
        LIMIT ${limitNum}
      `;
    }

    return apiResponse.success(res, {
      projects: results,
      count: results.length,
    });
  } catch (error) {
    log.error('Failed to search projects for linking', { error }, 'projects-search-api');
    return apiResponse.databaseError(res, error, 'Failed to search projects');
  }
}

export default withAuth(withErrorHandler(handler));
