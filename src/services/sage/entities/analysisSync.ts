/**
 * Analysis Sync Service
 *
 * Pulls analysis types (Site, BU) and their categories from Sage.
 * Upserts into sage_analysis_types and sage_analysis_categories.
 */

import { NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { SageClient } from '../sageClient';

const logger = createLogger('sage:analysis-sync');

export interface AnalysisSyncResult {
  success: boolean;
  types: { total: number; created: number; updated: number };
  categories: { total: number; created: number; updated: number };
  errors: Array<{ id: string; error: string }>;
}

/**
 * Pull analysis types and categories from Sage
 */
export async function pullAnalysisData(
  client: SageClient,
  sql: NeonQueryFunction<false, false>
): Promise<AnalysisSyncResult> {
  const result: AnalysisSyncResult = {
    success: true,
    types: { total: 0, created: 0, updated: 0 },
    categories: { total: 0, created: 0, updated: 0 },
    errors: [],
  };

  try {
    logger.info('Starting analysis data pull from Sage');

    // Step 1: Fetch and upsert analysis types
    const typesResponse = await client.getAnalysisTypes();
    const types = typesResponse.Results || [];
    result.types.total = types.length;

    logger.info(`Fetched ${types.length} analysis types from Sage`);

    for (const type of types) {
      try {
        const existing = await sql`
          SELECT id FROM sage_analysis_types
          WHERE sage_type_id = ${type.ID}
        `;

        if (existing.length > 0) {
          await sql`
            UPDATE sage_analysis_types
            SET
              description = ${type.Description},
              is_active = ${type.Active},
              updated_at = NOW()
            WHERE sage_type_id = ${type.ID}
          `;
          result.types.updated++;
        } else {
          // Derive a code from description (e.g., "Site" or "BU")
          const code = deriveTypeCode(type.Description);
          await sql`
            INSERT INTO sage_analysis_types (
              sage_type_id, description, code, is_active
            ) VALUES (
              ${type.ID}, ${type.Description}, ${code}, ${type.Active}
            )
          `;
          result.types.created++;
        }
      } catch (error) {
        result.errors.push({
          id: type.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to upsert analysis type ${type.ID}`, { error });
      }
    }

    // Step 2: Fetch and upsert categories for each type
    const categoriesResponse = await client.getAnalysisCategories({ take: 500 });
    const categories = categoriesResponse.Results || [];
    result.categories.total = categories.length;

    logger.info(`Fetched ${categories.length} analysis categories from Sage`);

    // Build type code lookup
    const typeCodeMap = new Map<string, string>();
    const typeRows = await sql`SELECT sage_type_id, code FROM sage_analysis_types`;
    for (const row of typeRows) {
      typeCodeMap.set(row.sage_type_id as string, row.code as string);
    }

    for (const cat of categories) {
      try {
        const typeCode = typeCodeMap.get(cat.AnalysisTypeId) || null;
        const existing = await sql`
          SELECT id, mapping_status FROM sage_analysis_categories
          WHERE sage_category_id = ${cat.ID}
        `;

        if (existing.length > 0) {
          // Preserve mapping when updating
          await sql`
            UPDATE sage_analysis_categories
            SET
              description = ${cat.Description},
              is_active = ${cat.Active},
              type_code = ${typeCode},
              updated_at = NOW()
            WHERE sage_category_id = ${cat.ID}
          `;
          result.categories.updated++;
        } else {
          await sql`
            INSERT INTO sage_analysis_categories (
              sage_category_id, sage_type_id, description,
              type_code, is_active
            ) VALUES (
              ${cat.ID}, ${cat.AnalysisTypeId}, ${cat.Description},
              ${typeCode}, ${cat.Active}
            )
          `;
          result.categories.created++;
        }
      } catch (error) {
        result.errors.push({
          id: cat.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to upsert analysis category ${cat.ID}`, { error });
      }
    }

    // Log sync
    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status,
        records_processed, records_success, records_failed, details
      ) VALUES (
        'analysis_sync', 'inbound', 'analysis',
        ${result.errors.length === 0 ? 'success' : 'partial'},
        ${result.types.total + result.categories.total},
        ${result.types.created + result.types.updated + result.categories.created + result.categories.updated},
        ${result.errors.length},
        ${JSON.stringify(result)}
      )
    `;

    logger.info('Analysis sync completed', { data: result });

  } catch (error) {
    result.success = false;
    logger.error('Analysis sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status, error_message
      ) VALUES (
        'analysis_sync', 'inbound', 'analysis', 'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

/**
 * Get analysis sync status
 */
export async function getAnalysisSyncStatus(
  sql: NeonQueryFunction<false, false>
): Promise<{
  types: Array<{ id: string; sageTypeId: string; description: string; code: string; categoryCount: number }>;
  unmappedSites: number;
  mappedSites: number;
  totalCategories: number;
  lastSync: Record<string, unknown> | null;
}> {
  const types = await sql`
    SELECT
      sat.id,
      sat.sage_type_id,
      sat.description,
      sat.code,
      COUNT(sac.id) as category_count
    FROM sage_analysis_types sat
    LEFT JOIN sage_analysis_categories sac ON sac.sage_type_id = sat.sage_type_id
    WHERE sat.is_active = true
    GROUP BY sat.id, sat.sage_type_id, sat.description, sat.code
    ORDER BY sat.description
  `;

  const mappingStats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE mapping_status = 'unmapped') as unmapped,
      COUNT(*) FILTER (WHERE mapping_status = 'mapped') as mapped,
      COUNT(*) as total
    FROM sage_analysis_categories
    WHERE type_code = 'site'
  `;

  const lastSync = await sql`
    SELECT * FROM sage_sync_history
    WHERE entity_type = 'analysis'
    ORDER BY created_at DESC LIMIT 1
  `;

  return {
    types: types.map(t => ({
      id: t.id as string,
      sageTypeId: t.sage_type_id as string,
      description: t.description as string,
      code: t.code as string,
      categoryCount: parseInt(t.category_count as string || '0'),
    })),
    unmappedSites: parseInt(mappingStats[0]?.unmapped as string || '0'),
    mappedSites: parseInt(mappingStats[0]?.mapped as string || '0'),
    totalCategories: parseInt(mappingStats[0]?.total as string || '0'),
    lastSync: lastSync[0] || null,
  };
}

/**
 * Derive a short code from analysis type description
 */
function deriveTypeCode(description: string): string {
  const lower = description.toLowerCase().trim();
  if (lower.includes('site') || lower.includes('location') || lower.includes('project')) {
    return 'site';
  }
  if (lower.includes('bu') || lower.includes('business unit') || lower.includes('department')) {
    return 'bu';
  }
  // Default: use first word lowercase
  return lower.split(/\s+/)[0]!.substring(0, 20);
}
