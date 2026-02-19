/**
 * Sage Site-to-Project Mapping API
 *
 * GET - List all Sage site categories with their FF project mappings
 * PUT - Update mapping for a site category
 * POST - Auto-match sites to projects using fuzzy matching
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:sage:mappings:sites');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const sql = neon(process.env.DATABASE_URL!);

  // GET - List all site categories with mappings
  if (req.method === 'GET') {
    try {
      const sites = await sql`
        SELECT
          sac.id,
          sac.sage_category_id,
          sac.description as site_name,
          sac.is_active,
          sac.mapping_status,
          sac.ff_project_id,
          sac.mapped_at,
          sac.mapped_by,
          p.project_name,
          p.status as project_status
        FROM sage_analysis_categories sac
        LEFT JOIN projects p ON p.id = sac.ff_project_id
        WHERE sac.type_code = 'site'
        ORDER BY sac.description
      `;

      // Also get available projects for dropdown
      const projects = await sql`
        SELECT id, project_name as name, status
        FROM projects
        WHERE status NOT IN ('cancelled', 'archived')
        ORDER BY project_name
      `;

      return apiResponse.success(res, {
        sites,
        projects,
        stats: {
          total: sites.length,
          mapped: sites.filter((s: Record<string, unknown>) => s.mapping_status === 'mapped').length,
          unmapped: sites.filter((s: Record<string, unknown>) => s.mapping_status === 'unmapped').length,
        },
      });
    } catch (error) {
      logger.error('Failed to get site mappings', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // PUT - Update a single site mapping
  if (req.method === 'PUT') {
    const { sageCategoryId, projectId } = req.body;

    if (!sageCategoryId) {
      return apiResponse.badRequest(res, 'sageCategoryId is required');
    }

    try {
      if (projectId) {
        // Map site to project
        await sql`
          UPDATE sage_analysis_categories
          SET
            ff_project_id = ${projectId},
            mapping_status = 'mapped',
            mapped_at = NOW(),
            updated_at = NOW()
          WHERE sage_category_id = ${sageCategoryId}
        `;

        // Also update any existing ledger transactions with this site
        await sql`
          UPDATE sage_ledger_transactions
          SET ff_project_id = ${projectId}, updated_at = NOW()
          WHERE sage_site_category_id = ${sageCategoryId}
        `;

        logger.info(`Mapped site ${sageCategoryId} to project ${projectId}`);
      } else {
        // Unmap site
        await sql`
          UPDATE sage_analysis_categories
          SET
            ff_project_id = NULL,
            mapping_status = 'unmapped',
            mapped_at = NULL,
            mapped_by = NULL,
            updated_at = NOW()
          WHERE sage_category_id = ${sageCategoryId}
        `;

        await sql`
          UPDATE sage_ledger_transactions
          SET ff_project_id = NULL, updated_at = NOW()
          WHERE sage_site_category_id = ${sageCategoryId}
        `;

        logger.info(`Unmapped site ${sageCategoryId}`);
      }

      return apiResponse.success(res, { message: 'Mapping updated' });
    } catch (error) {
      logger.error('Failed to update site mapping', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Auto-match sites to projects
  if (req.method === 'POST') {
    const { action } = req.body;

    if (action !== 'auto_match') {
      return apiResponse.badRequest(res, 'Invalid action. Use action: "auto_match"');
    }

    try {
      // Get unmapped sites
      const unmappedSites = await sql`
        SELECT sage_category_id, description
        FROM sage_analysis_categories
        WHERE type_code = 'site'
          AND mapping_status = 'unmapped'
          AND is_active = true
      `;

      let matched = 0;
      const results: Array<{ site: string; project: string | null; confidence: number }> = [];

      for (const site of unmappedSites) {
        const siteName = site.description as string;

        // Try exact match first
        const exactMatch = await sql`
          SELECT id, project_name as name FROM projects
          WHERE LOWER(project_name) = LOWER(${siteName})
            AND status NOT IN ('cancelled', 'archived')
          LIMIT 1
        `;

        if (exactMatch.length > 0) {
          await sql`
            UPDATE sage_analysis_categories
            SET
              ff_project_id = ${exactMatch[0].id},
              mapping_status = 'mapped',
              mapped_at = NOW(),
              mapped_by = 'auto_match',
              updated_at = NOW()
            WHERE sage_category_id = ${site.sage_category_id}
          `;
          matched++;
          results.push({ site: siteName, project: exactMatch[0].name as string, confidence: 1.0 });
          continue;
        }

        // Try fuzzy match using pg_trgm
        const fuzzyMatch = await sql`
          SELECT id, project_name as name,
                 similarity(LOWER(project_name), LOWER(${siteName})) as sim
          FROM projects
          WHERE status NOT IN ('cancelled', 'archived')
            AND similarity(LOWER(project_name), LOWER(${siteName})) > 0.4
          ORDER BY sim DESC
          LIMIT 1
        `;

        if (fuzzyMatch.length > 0) {
          const confidence = parseFloat(fuzzyMatch[0].sim as string);
          // Only auto-map if confidence > 0.7
          if (confidence > 0.7) {
            await sql`
              UPDATE sage_analysis_categories
              SET
                ff_project_id = ${fuzzyMatch[0].id},
                mapping_status = 'mapped',
                mapped_at = NOW(),
                mapped_by = 'auto_match',
                updated_at = NOW()
              WHERE sage_category_id = ${site.sage_category_id}
            `;
            matched++;
          }
          results.push({
            site: siteName,
            project: fuzzyMatch[0].name as string,
            confidence,
          });
        } else {
          results.push({ site: siteName, project: null, confidence: 0 });
        }
      }

      // Backfill ledger transactions with new mappings
      await sql`
        UPDATE sage_ledger_transactions slt
        SET ff_project_id = sac.ff_project_id
        FROM sage_analysis_categories sac
        WHERE slt.sage_site_category_id = sac.sage_category_id
          AND sac.mapping_status = 'mapped'
          AND slt.ff_project_id IS NULL
      `;

      return apiResponse.success(res, {
        totalUnmapped: unmappedSites.length,
        matched,
        results,
      });
    } catch (error) {
      logger.error('Auto-match failed', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'POST']);
}

export default withAuth(handler);
