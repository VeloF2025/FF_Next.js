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
  installed: number;
  activated: number;
  complete: number;
  incomplete: number;
}

interface Summary {
  /** Total unique drops (counted once at first install) */
  totalDrops: number;
  /** Unique valid DRs from WhatsApp */
  installed: number;
  /** DRs present in OES activation report */
  activated: number;
  /** DRs not yet fully QA reviewed */
  incomplete: number;
  /** DRs marked complete by HITL/AI */
  complete: number;
  /** DRs with feedback sent */
  totalFeedback: number;
  // Legacy fields for backward compatibility
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

  // Build queries
  const countQuery = `SELECT COUNT(*) FROM dr_photo_unified_reviews ${whereClause}`;
  const dataQuery = `
    SELECT * FROM dr_photo_unified_reviews
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const dataParams = [...params, pageSize, offset];

  // Run count and data queries in parallel for faster response
  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, dataParams),
  ]);

  const totalCount = parseInt(countResult.rows[0].count, 10);

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
 * Calculate summary statistics with optional filters
 *
 * Terminology:
 * - totalDrops: Total unique drops (counted once at first install)
 * - installed: Unique valid DRs from WhatsApp (qa_photo_reviews)
 * - activated: DRs present in OES activation report (oes_activations)
 * - incomplete: DRs not yet fully QA reviewed
 * - complete: DRs marked complete by HITL/AI
 */
async function calculateSummary(filters?: {
  dateFrom?: string;
  dateTo?: string;
  project?: string;
  status?: string;
}): Promise<Summary> {
  // Build date conditions for each table
  const buildConditions = (dateCol: string, projectCol: string) => {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.dateFrom) {
      conditions.push(`${dateCol} >= $${paramIndex}::DATE`);
      params.push(filters.dateFrom);
      paramIndex++;
    }
    if (filters?.dateTo) {
      conditions.push(`${dateCol} <= $${paramIndex}::DATE`);
      params.push(filters.dateTo);
      paramIndex++;
    }
    if (filters?.project && filters.project !== 'all') {
      conditions.push(`${projectCol} = $${paramIndex}`);
      params.push(filters.project);
      paramIndex++;
    }
    return { conditions, params, whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '' };
  };

  // Conditions for dr_photo_unified_reviews
  const unifiedCond = buildConditions(
    'COALESCE(submitted_date, created_at::DATE)',
    'project'
  );
  // Conditions with upr. prefix for EXISTS subqueries (avoids ambiguous column reference)
  const unifiedCondWithAlias = buildConditions(
    'COALESCE(upr.submitted_date, upr.created_at::DATE)',
    'upr.project'
  );

  const isCompleteCondition = `
    step_01_house_photo AND step_02_cable_from_pole AND step_03_entry_outside AND
    step_04_entry_inside AND step_05_wall AND step_06_ont_back AND
    step_07_power_meter AND step_08_final_installation AND step_09_green_lights AND
    step_10_signature
  `;

  // Query 1: Complete/Incomplete from dr_photo_unified_reviews
  const unifiedQuery = `
    SELECT
      COUNT(*) as total_drops,
      COUNT(*) FILTER (WHERE ${isCompleteCondition}) as complete,
      COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'pending' OR vlm_categorization_status IS NULL) as vlm_pending,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'processing') as vlm_processing,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'categorized' OR vlm_categorization_status = 'approved') as vlm_categorized,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'failed') as vlm_failed
    FROM dr_photo_unified_reviews
    ${unifiedCond.whereClause}
  `;

  // Query 2: Installed count - DRs whose FIRST submission (submitted_date) is in date range
  // Uses unified table to avoid counting resubmissions from qa_photo_reviews
  // Only counts DRs that exist in qa_photo_reviews (confirmed from WhatsApp)
  const installedQuery = `
    SELECT COUNT(DISTINCT drop_number) as installed
    FROM dr_photo_unified_reviews
    WHERE EXISTS (SELECT 1 FROM qa_photo_reviews qpr WHERE qpr.drop_number = dr_photo_unified_reviews.drop_number)
    ${unifiedCond.conditions.length > 0 ? 'AND ' + unifiedCond.conditions.join(' AND ') : ''}
  `;

  // Query 3: Activated count - DRs in OES whose unified submitted_date is in date range
  // Only counts if the DR exists in unified (valid DR with first submission in range)
  const activatedQuery = `
    SELECT COUNT(DISTINCT oes.drop_number) as activated
    FROM oes_activations oes
    WHERE EXISTS (
      SELECT 1 FROM dr_photo_unified_reviews upr
      WHERE upr.drop_number = oes.drop_number
      ${unifiedCondWithAlias.conditions.length > 0 ? 'AND ' + unifiedCondWithAlias.conditions.join(' AND ') : ''}
    )
  `;

  // Run all queries in parallel
  const [unifiedResult, installedResult, activatedResult] = await Promise.all([
    pool.query(unifiedQuery, unifiedCond.params),
    pool.query(installedQuery, unifiedCond.params),
    pool.query(activatedQuery, unifiedCondWithAlias.params),
  ]);

  const unifiedRow = unifiedResult.rows[0];
  const installed = parseInt(installedResult.rows[0]?.installed || '0', 10);
  const activated = parseInt(activatedResult.rows[0]?.activated || '0', 10);

  let total = parseInt(unifiedRow.total_drops, 10);
  let complete = parseInt(unifiedRow.complete, 10);
  let incomplete = total - complete;
  const feedbackSent = parseInt(unifiedRow.feedback_sent, 10);

  // Apply status filter to the results
  if (filters?.status === 'complete') {
    total = complete;
    incomplete = 0;
  } else if (filters?.status === 'incomplete') {
    total = incomplete;
    complete = 0;
  }

  return {
    totalDrops: total,
    installed,
    activated,
    incomplete: filters?.status === 'complete' ? 0 : (filters?.status === 'incomplete' ? total : incomplete),
    complete,
    totalFeedback: feedbackSent,
    // Legacy fields
    feedback_sent: feedbackSent,
    vlm_pending: parseInt(unifiedRow.vlm_pending, 10),
    vlm_processing: parseInt(unifiedRow.vlm_processing, 10),
    vlm_categorized: parseInt(unifiedRow.vlm_categorized, 10),
    vlm_failed: parseInt(unifiedRow.vlm_failed, 10),
  };
}

/**
 * Get project statistics with optional filtering
 *
 * Returns per-project stats including:
 * - total: Total unique drops
 * - installed: Unique DRs from WhatsApp
 * - activated: DRs in OES report
 * - complete: QA reviewed complete
 * - incomplete: Not yet QA complete
 */
async function getProjectStats(filters?: {
  dateFrom?: string;
  dateTo?: string;
  project?: string;
  status?: string;
}): Promise<ProjectStats[]> {
  // Build conditions for each table type
  const buildConditions = (dateCol: string, projectCol: string) => {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.dateFrom) {
      conditions.push(`${dateCol} >= $${paramIndex}::DATE`);
      params.push(filters.dateFrom);
      paramIndex++;
    }
    if (filters?.dateTo) {
      conditions.push(`${dateCol} <= $${paramIndex}::DATE`);
      params.push(filters.dateTo);
      paramIndex++;
    }
    if (filters?.project && filters.project !== 'all') {
      conditions.push(`${projectCol} = $${paramIndex}`);
      params.push(filters.project);
      paramIndex++;
    }
    return { conditions, params, whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '' };
  };

  const isCompleteCondition = `
    step_01_house_photo AND step_02_cable_from_pole AND step_03_entry_outside AND
    step_04_entry_inside AND step_05_wall AND step_06_ont_back AND
    step_07_power_meter AND step_08_final_installation AND step_09_green_lights AND
    step_10_signature
  `;

  // Conditions based on unified table's submitted_date (first submission)
  const unifiedCond = buildConditions('COALESCE(submitted_date, created_at::DATE)', 'project');
  // Conditions with upr. prefix for JOIN queries (avoids ambiguous column reference)
  const unifiedCondWithAlias = buildConditions('COALESCE(upr.submitted_date, upr.created_at::DATE)', 'upr.project');

  // Query 1: Complete/Incomplete from dr_photo_unified_reviews grouped by project
  const unifiedQuery = `
    SELECT
      COALESCE(project, 'Unknown') as project,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE ${isCompleteCondition}) as complete
    FROM dr_photo_unified_reviews
    ${unifiedCond.whereClause}
    GROUP BY COALESCE(project, 'Unknown')
  `;

  // Query 2: Installed from unified - DRs with first submission in date range that exist in qa_photo_reviews
  const installedQuery = `
    SELECT
      COALESCE(project, 'Unknown') as project,
      COUNT(DISTINCT drop_number) as installed
    FROM dr_photo_unified_reviews
    WHERE EXISTS (SELECT 1 FROM qa_photo_reviews qpr WHERE qpr.drop_number = dr_photo_unified_reviews.drop_number)
    ${unifiedCond.conditions.length > 0 ? 'AND ' + unifiedCond.conditions.join(' AND ') : ''}
    GROUP BY COALESCE(project, 'Unknown')
  `;

  // Query 3: Activated - DRs in OES whose unified submitted_date is in date range
  const activatedQuery = `
    SELECT
      COALESCE(upr.project, 'Unknown') as project,
      COUNT(DISTINCT oes.drop_number) as activated
    FROM oes_activations oes
    INNER JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    ${unifiedCondWithAlias.conditions.length > 0 ? 'WHERE ' + unifiedCondWithAlias.conditions.join(' AND ') : ''}
    GROUP BY COALESCE(upr.project, 'Unknown')
  `;

  // Run all queries in parallel
  const [unifiedResult, installedResult, activatedResult] = await Promise.all([
    pool.query(unifiedQuery, unifiedCond.params),
    pool.query(installedQuery, unifiedCond.params),
    pool.query(activatedQuery, unifiedCondWithAlias.params),
  ]);

  // Merge results by project
  const projectMap = new Map<string, ProjectStats>();

  // Initialize from unified results (total, complete, incomplete)
  for (const row of unifiedResult.rows) {
    const total = parseInt(row.total, 10);
    const complete = parseInt(row.complete, 10);
    projectMap.set(row.project, {
      project: row.project,
      total,
      installed: 0,
      activated: 0,
      complete,
      incomplete: total - complete,
    });
  }

  // Add installed counts
  for (const row of installedResult.rows) {
    const existing = projectMap.get(row.project);
    if (existing) {
      existing.installed = parseInt(row.installed, 10);
    } else {
      projectMap.set(row.project, {
        project: row.project,
        total: 0,
        installed: parseInt(row.installed, 10),
        activated: 0,
        complete: 0,
        incomplete: 0,
      });
    }
  }

  // Add activated counts
  for (const row of activatedResult.rows) {
    const existing = projectMap.get(row.project);
    if (existing) {
      existing.activated = parseInt(row.activated, 10);
    } else {
      projectMap.set(row.project, {
        project: row.project,
        total: 0,
        installed: 0,
        activated: parseInt(row.activated, 10),
        complete: 0,
        incomplete: 0,
      });
    }
  }

  // Convert to array and sort by total descending
  const stats = Array.from(projectMap.values());

  // Apply status filter
  if (filters?.status === 'complete') {
    return stats
      .filter((s) => s.complete > 0)
      .map((s) => ({ ...s, total: s.complete, incomplete: 0 }))
      .sort((a, b) => b.total - a.total);
  } else if (filters?.status === 'incomplete') {
    return stats
      .filter((s) => s.incomplete > 0)
      .map((s) => ({ ...s, total: s.incomplete, complete: 0 }))
      .sort((a, b) => b.total - a.total);
  }

  return stats.sort((a, b) => b.total - a.total);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  try {
    const { id, dropNumber, search, page, skipSummary, dateFrom, dateTo, project, status } = req.query;

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

    // Parse filter parameters first (needed for parallel queries)
    const filters = {
      dateFrom: dateFrom && typeof dateFrom === 'string' ? dateFrom : undefined,
      dateTo: dateTo && typeof dateTo === 'string' ? dateTo : undefined,
      project: project && typeof project === 'string' ? project : undefined,
      status: status && typeof status === 'string' ? status : undefined,
    };

    const searchTerm = search && typeof search === 'string' ? search : undefined;

    // Run all queries in parallel for faster response
    const [result, summary, projectStats] = await Promise.all([
      getPaginatedDrops(currentPage, pageSize, searchTerm),
      skipSummary === 'true' ? Promise.resolve(null) : calculateSummary(filters),
      getProjectStats(filters),
    ]);

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
        filters: (filters.dateFrom || filters.dateTo || filters.project || filters.status) ? filters : null,
      },
    });
  } catch (error: any) {
    log.error('DrPhotoUnifiedDropsAPI', 'Error fetching drops', error);
    return apiResponse.internalError(res, error);
  }
}
