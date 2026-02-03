/**
 * Pipeline Projects Search API
 * GET /api/pipeline/projects/search - Search available pipeline projects for linking
 *
 * Query params:
 * - q: Search query (matches project name, area, municipality)
 * - exclude: Comma-separated UUIDs to exclude (already linked)
 * - status: Filter by pipeline status
 * - client_id: Filter by client
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
      exclude,
      status,
      client_id,
      project_id,
      limit = '20',
    } = req.query;

    const searchQuery = typeof q === 'string' ? q.trim() : '';
    const excludeIds = typeof exclude === 'string' ? exclude.split(',').filter(Boolean) : [];
    const statusFilter = typeof status === 'string' ? status : null;
    const clientFilter = typeof client_id === 'string' ? client_id : null;
    const projectIdFilter = typeof project_id === 'string' ? project_id : null;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);

    // If project_id is provided, get already linked pipeline IDs to exclude
    let linkedPipelineIds: string[] = [];
    if (projectIdFilter) {
      const linkedResult = await sql`
        SELECT pipeline_project_id FROM project_pipeline_links
        WHERE project_id = ${projectIdFilter}
      `;
      linkedPipelineIds = linkedResult.map((r: { pipeline_project_id: string }) => r.pipeline_project_id);
    }

    const allExcludeIds = [...excludeIds, ...linkedPipelineIds];

    // Build query based on filters
    // Using explicit branches instead of conditional SQL fragments (Neon compatibility)
    let results;

    if (searchQuery && statusFilter && clientFilter && allExcludeIds.length > 0) {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
          AND pp.id NOT IN ${sql(allExcludeIds)}
          AND pp.pipeline_status = ${statusFilter}
          AND pp.client_id = ${clientFilter}
          AND (
            pp.project_name ILIKE ${'%' + searchQuery + '%'}
            OR pp.area ILIKE ${'%' + searchQuery + '%'}
            OR pp.municipality ILIKE ${'%' + searchQuery + '%'}
          )
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (searchQuery && statusFilter && allExcludeIds.length > 0) {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
          AND pp.id NOT IN ${sql(allExcludeIds)}
          AND pp.pipeline_status = ${statusFilter}
          AND (
            pp.project_name ILIKE ${'%' + searchQuery + '%'}
            OR pp.area ILIKE ${'%' + searchQuery + '%'}
            OR pp.municipality ILIKE ${'%' + searchQuery + '%'}
          )
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (searchQuery && clientFilter && allExcludeIds.length > 0) {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
          AND pp.id NOT IN ${sql(allExcludeIds)}
          AND pp.client_id = ${clientFilter}
          AND (
            pp.project_name ILIKE ${'%' + searchQuery + '%'}
            OR pp.area ILIKE ${'%' + searchQuery + '%'}
            OR pp.municipality ILIKE ${'%' + searchQuery + '%'}
          )
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (searchQuery && allExcludeIds.length > 0) {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
          AND pp.id NOT IN ${sql(allExcludeIds)}
          AND (
            pp.project_name ILIKE ${'%' + searchQuery + '%'}
            OR pp.area ILIKE ${'%' + searchQuery + '%'}
            OR pp.municipality ILIKE ${'%' + searchQuery + '%'}
          )
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (searchQuery) {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
          AND (
            pp.project_name ILIKE ${'%' + searchQuery + '%'}
            OR pp.area ILIKE ${'%' + searchQuery + '%'}
            OR pp.municipality ILIKE ${'%' + searchQuery + '%'}
          )
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    } else if (allExcludeIds.length > 0) {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
          AND pp.id NOT IN ${sql(allExcludeIds)}
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    } else {
      results = await sql`
        SELECT
          pp.id,
          pp.project_name,
          pp.pipeline_status,
          pp.area,
          pp.municipality,
          pp.province,
          pp.client_id,
          c.company_name as client_name,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
          ) as approval_count,
          (
            SELECT COUNT(*)
            FROM pipeline_project_approvals ppa
            JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
            WHERE ppa.pipeline_project_id = pp.id
              AND pat.category = 'wayleave'
              AND ppa.is_required = true
              AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
          ) as approved_count
        FROM pipeline_projects pp
        LEFT JOIN clients c ON c.id = pp.client_id
        WHERE pp.is_deleted = false
        ORDER BY pp.project_name ASC
        LIMIT ${limitNum}
      `;
    }

    return apiResponse.success(res, {
      projects: results,
      count: results.length,
    });
  } catch (error) {
    log.error('Failed to search pipeline projects', { error }, 'pipeline-search-api');
    return apiResponse.databaseError(res, error, 'Failed to search pipeline projects');
  }
}

export default withAuth(withErrorHandler(handler));
