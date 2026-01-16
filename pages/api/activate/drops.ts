/**
 * DR Photo Unified Drops API
 * GET /api/activate/drops
 *
 * Endpoints:
 * - GET /api/activate/drops - Get all drops with summary
 * - GET /api/activate/drops?id={id} - Get single drop by ID
 * - GET /api/activate/drops?dropNumber={dropNumber} - Get drop by drop number
 *
 * Returns unified DR photo review data from Neon PostgreSQL
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface UnifiedDrop {
  id: string;
  drop_number: string;
  project: string | null;
  photo_source: string | null;
  photo_count: number;
  photos_metadata: any[];
  vlm_categorization_status: string | null;
  vlm_categorization_results: any[];
  vlm_categorized_at: string | null;
  feedback_sent: boolean;
  created_at: string;
  updated_at: string;
  // Step completion status (10 steps after migration 054)
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_entry_outside: boolean;
  step_04_entry_inside: boolean;
  step_05_wall: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_final_installation: boolean;
  step_09_green_lights: boolean;
  step_10_signature: boolean;
  // Calculated fields
  is_complete: boolean;
  steps_completed: number;
  steps_total: number;
}

interface ProjectStats {
  project: string;
  total: number;
  complete: number;
  incomplete: number;
}

interface Summary {
  total_drops: number;
  complete: number;
  incomplete: number;
  feedback_sent: number;
  vlm_pending: number;
  vlm_processing: number;
  vlm_categorized: number;
  vlm_failed: number;
}

/**
 * Calculate if a drop is complete (all 10 steps done)
 * Step names after migration 054
 */
function isDropComplete(drop: any): boolean {
  return (
    drop.step_01_house_photo &&
    drop.step_02_cable_from_pole &&
    drop.step_03_entry_outside &&
    drop.step_04_entry_inside &&
    drop.step_05_wall &&
    drop.step_06_ont_back &&
    drop.step_07_power_meter &&
    drop.step_08_final_installation &&
    drop.step_09_green_lights &&
    drop.step_10_signature
  );
}

/**
 * Count completed steps (10 steps after migration 054)
 */
function countCompletedSteps(drop: any): number {
  let count = 0;
  if (drop.step_01_house_photo) count++;
  if (drop.step_02_cable_from_pole) count++;
  if (drop.step_03_entry_outside) count++;
  if (drop.step_04_entry_inside) count++;
  if (drop.step_05_wall) count++;
  if (drop.step_06_ont_back) count++;
  if (drop.step_07_power_meter) count++;
  if (drop.step_08_final_installation) count++;
  if (drop.step_09_green_lights) count++;
  if (drop.step_10_signature) count++;
  return count;
}

/**
 * Get paginated drops from dr_photo_unified_reviews
 */
async function getPaginatedDrops(
  page: number,
  pageSize: number,
  searchTerm?: string
): Promise<{ drops: UnifiedDrop[]; pagination: any }> {
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  const params: any[] = [];

  if (searchTerm) {
    whereClause = 'WHERE drop_number ILIKE $1 OR project ILIKE $1';
    params.push(`%${searchTerm}%`);
  }

  // Get total count
  const countQuery = `SELECT COUNT(*) FROM dr_photo_unified_reviews ${whereClause}`;
  const countResult = await pool.query(countQuery, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  // Get paginated data
  const dataQuery = `
    SELECT * FROM dr_photo_unified_reviews
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const dataParams = [...params, pageSize, offset];
  const dataResult = await pool.query(dataQuery, dataParams);

  // Transform rows with calculated fields
  const drops = dataResult.rows.map((row: any) => ({
    ...row,
    is_complete: isDropComplete(row),
    steps_completed: countCompletedSteps(row),
    steps_total: 10,
  }));

  return {
    drops,
    pagination: {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      hasNextPage: page * pageSize < totalCount,
      hasPreviousPage: page > 1,
    },
  };
}

/**
 * Get drop by ID
 */
async function getDropById(id: string): Promise<UnifiedDrop | null> {
  const result = await pool.query(
    'SELECT * FROM dr_photo_unified_reviews WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    ...row,
    is_complete: isDropComplete(row),
    steps_completed: countCompletedSteps(row),
    steps_total: 10,
  };
}

/**
 * Get drop by drop number
 */
async function getDropByDropNumber(dropNumber: string): Promise<UnifiedDrop | null> {
  const result = await pool.query(
    'SELECT * FROM dr_photo_unified_reviews WHERE drop_number = $1',
    [dropNumber]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    ...row,
    is_complete: isDropComplete(row),
    steps_completed: countCompletedSteps(row),
    steps_total: 10,
  };
}

/**
 * Calculate summary statistics
 */
async function calculateSummary(): Promise<Summary> {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total_drops,
      COUNT(*) FILTER (WHERE
        step_01_house_photo AND step_02_cable_from_pole AND step_03_entry_outside AND
        step_04_entry_inside AND step_05_wall AND step_06_ont_back AND
        step_07_power_meter AND step_08_final_installation AND step_09_green_lights AND
        step_10_signature
      ) as complete,
      COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'pending' OR vlm_categorization_status IS NULL) as vlm_pending,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'processing') as vlm_processing,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'categorized' OR vlm_categorization_status = 'approved') as vlm_categorized,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'failed') as vlm_failed
    FROM dr_photo_unified_reviews
  `);

  const row = result.rows[0];
  const total = parseInt(row.total_drops, 10);
  const complete = parseInt(row.complete, 10);

  return {
    total_drops: total,
    complete,
    incomplete: total - complete,
    feedback_sent: parseInt(row.feedback_sent, 10),
    vlm_pending: parseInt(row.vlm_pending, 10),
    vlm_processing: parseInt(row.vlm_processing, 10),
    vlm_categorized: parseInt(row.vlm_categorized, 10),
    vlm_failed: parseInt(row.vlm_failed, 10),
  };
}

/**
 * Get project statistics with optional date filtering
 */
async function getProjectStats(dateFrom?: string, dateTo?: string): Promise<ProjectStats[]> {
  let whereClause = '';
  const params: any[] = [];

  if (dateFrom && dateTo) {
    whereClause = 'WHERE submitted_date >= $1::DATE AND submitted_date <= $2::DATE';
    params.push(dateFrom, dateTo);
  } else if (dateFrom) {
    whereClause = 'WHERE submitted_date >= $1::DATE';
    params.push(dateFrom);
  } else if (dateTo) {
    whereClause = 'WHERE submitted_date <= $1::DATE';
    params.push(dateTo);
  }

  const query = `
    SELECT
      COALESCE(project, 'Unknown') as project,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE
        step_01_house_photo AND step_02_cable_from_pole AND step_03_entry_outside AND
        step_04_entry_inside AND step_05_wall AND step_06_ont_back AND
        step_07_power_meter AND step_08_final_installation AND step_09_green_lights AND
        step_10_signature
      ) as complete
    FROM dr_photo_unified_reviews
    ${whereClause}
    GROUP BY COALESCE(project, 'Unknown')
    ORDER BY total DESC
  `;

  const result = await pool.query(query, params);

  return result.rows.map((row: any) => ({
    project: row.project,
    total: parseInt(row.total, 10),
    complete: parseInt(row.complete, 10),
    incomplete: parseInt(row.total, 10) - parseInt(row.complete, 10),
  }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  try {
    const { id, dropNumber, search, page, skipSummary, dateFrom, dateTo } = req.query;

    // Get single drop by ID
    if (id && typeof id === 'string') {
      const drop = await getDropById(id);

      if (!drop) {
        return apiResponse.notFound(res, 'Drop', id);
      }

      return apiResponse.success(res, drop);
    }

    // Get single drop by drop number
    if (dropNumber && typeof dropNumber === 'string') {
      const drop = await getDropByDropNumber(dropNumber);

      if (!drop) {
        return apiResponse.notFound(res, 'Drop', dropNumber);
      }

      return apiResponse.success(res, drop);
    }

    // Parse pagination parameters
    const pageSize = 100;
    let currentPage = 1;

    if (page && typeof page === 'string') {
      const parsedPage = parseInt(page, 10);
      if (!isNaN(parsedPage) && parsedPage > 0) {
        currentPage = parsedPage;
      }
    }

    // Get paginated drops
    const searchTerm = search && typeof search === 'string' ? search : undefined;
    const result = await getPaginatedDrops(currentPage, pageSize, searchTerm);

    // Optionally skip summary for faster initial load
    let summary = null;
    if (skipSummary !== 'true') {
      summary = await calculateSummary();
    }

    // Get project stats with date filtering
    const dateFromStr = dateFrom && typeof dateFrom === 'string' ? dateFrom : undefined;
    const dateToStr = dateTo && typeof dateTo === 'string' ? dateTo : undefined;
    const projectStats = await getProjectStats(dateFromStr, dateToStr);

    log.info('DrPhotoUnifiedDropsAPI', `Fetched ${result.drops.length} drops`, {
      page: currentPage,
      totalCount: result.pagination.totalCount,
    });

    return res.status(200).json({
      success: true,
      data: result.drops,
      summary,
      projectStats,
      pagination: result.pagination,
      meta: {
        timestamp: new Date().toISOString(),
        dateFilter: dateFromStr || dateToStr ? { from: dateFromStr, to: dateToStr } : null,
      },
    });
  } catch (error: any) {
    log.error('DrPhotoUnifiedDropsAPI', 'Error fetching drops', error);
    return apiResponse.internalError(res, error);
  }
}
