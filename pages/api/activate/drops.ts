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
  // OneMap synced data (from foto_ai_reviews)
  onemap_ont_serial: string | null;
  onemap_ups_serial: string | null;
  sender_phone: string | null;
  submitted_date: string | null;
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
  // Rich Status Model fields
  qa_phase: string | null;
  qa_decision: string | null;
  is_activated: boolean;
  // OES activation date (when activated on Nokia OES)
  oes_activation_date: string | null;
  // OES import timestamp (when OES report was imported)
  oes_imported_at: string | null;
  // Maintenance ticket (referred to maintenance)
  has_maintenance_ticket: boolean;
  maintenance_ticket_uid: string | null;
  // Resubmission tracking (Jan 2026)
  submission_count: number;
  is_resubmission: boolean;
  previous_photo_count: number | null;
}

interface ProjectStats {
  project: string;
  total: number;
  installed: number;
  activated: number;
  reviewed: number;
  notReviewed: number;
}

interface Summary {
  /** Total unique drops (counted once at first install) */
  totalDrops: number;
  /** Unique valid DRs from WhatsApp */
  installed: number;
  /** DRs present in OES activation report */
  activated: number;
  /** DRs not yet QA reviewed */
  notReviewed: number;
  /** DRs that have been QA reviewed */
  reviewed: number;
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
 * LEFT JOINs with foto_ai_reviews to get OneMap synced data (serials)
 */
async function getPaginatedDrops(
  page: number,
  pageSize: number,
  searchTerm?: string,
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    project?: string;
    status?: string;
    qaStatus?: string;
    serialStatus?: string;
    resubmissionsOnly?: boolean;
  }
): Promise<{ drops: UnifiedDrop[]; pagination: any }> {
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  // ALWAYS exclude OES-only records from the list (they have no WhatsApp submission)
  conditions.push('(u.is_oes_only = FALSE OR u.is_oes_only IS NULL)');

  // Search filter
  if (searchTerm) {
    conditions.push(`(u.drop_number ILIKE $${paramIndex} OR u.project ILIKE $${paramIndex})`);
    params.push(`%${searchTerm}%`);
    paramIndex++;
  }

  // Date filters - use submitted_date (WhatsApp submission date)
  // Don't fall back to created_at since OES-only records are already excluded
  if (filters?.dateFrom) {
    conditions.push(`u.submitted_date >= $${paramIndex}::DATE`);
    params.push(filters.dateFrom);
    paramIndex++;
  }
  if (filters?.dateTo) {
    conditions.push(`u.submitted_date <= $${paramIndex}::DATE`);
    params.push(filters.dateTo);
    paramIndex++;
  }

  // Project filter
  if (filters?.project && filters.project !== 'all') {
    conditions.push(`u.project = $${paramIndex}`);
    params.push(filters.project);
    paramIndex++;
  }

  // Status filter - aligned with DRState values
  // installed: DRs from WhatsApp (already filtered by table)
  // activated: DRs in OES report (need subquery)
  // not_reviewed: feedback_sent = false or null
  // reviewed: feedback_sent = true
  if (filters?.status === 'reviewed') {
    conditions.push('u.feedback_sent = true');
  } else if (filters?.status === 'not_reviewed' || filters?.status === 'notReviewed') {
    // Support both formats for backward compatibility
    conditions.push('(u.feedback_sent IS NULL OR u.feedback_sent = false)');
  } else if (filters?.status === 'activated') {
    // Only DRs that are in OES activations
    conditions.push('EXISTS (SELECT 1 FROM oes_activations oes WHERE oes.drop_number = u.drop_number)');
  } else if (filters?.status === 'installed') {
    // DRs that are NOT in OES activations (installed but not activated)
    conditions.push('NOT EXISTS (SELECT 1 FROM oes_activations oes WHERE oes.drop_number = u.drop_number)');
  }

  // QA Status filter - filter by qa_decision field
  if (filters?.qaStatus === 'pending') {
    conditions.push('(u.qa_decision IS NULL)');
  } else if (filters?.qaStatus === 'passed') {
    conditions.push("u.qa_decision = 'PASS'");
  } else if (filters?.qaStatus === 'failed') {
    conditions.push("u.qa_decision = 'FAIL'");
  } else if (filters?.qaStatus === 'rework') {
    conditions.push("u.qa_decision = 'REWORK_NEEDED'");
  }

  // Serial Status filter - filter by ONT/UPS serial validation
  // valid = both serials present and correct format
  // swapped = ONT looks like UPS or vice versa
  // missing = ONT or UPS serial is NULL
  // invalid = serial present but wrong format
  if (filters?.serialStatus === 'valid') {
    // Both serials present and match expected patterns (ONT: ALCL/ALCB, UPS: GU18W)
    conditions.push(`(
      u.ont_serial_scanned IS NOT NULL
      AND u.ups_serial_scanned IS NOT NULL
      AND (u.ont_serial_scanned LIKE 'ALCL%' OR u.ont_serial_scanned LIKE 'ALCB%')
      AND u.ups_serial_scanned LIKE 'GU18W%'
    )`);
  } else if (filters?.serialStatus === 'swapped') {
    // ONT looks like UPS (GU18W) OR UPS looks like ONT (ALCL/ALCB)
    conditions.push(`(
      (u.ont_serial_scanned LIKE 'GU18W%')
      OR (u.ups_serial_scanned LIKE 'ALCL%' OR u.ups_serial_scanned LIKE 'ALCB%')
    )`);
  } else if (filters?.serialStatus === 'missing') {
    // Either serial is NULL
    conditions.push('(u.ont_serial_scanned IS NULL OR u.ups_serial_scanned IS NULL)');
  } else if (filters?.serialStatus === 'invalid') {
    // Serial present but doesn't match expected pattern (and not swapped)
    conditions.push(`(
      (u.ont_serial_scanned IS NOT NULL AND u.ont_serial_scanned NOT LIKE 'ALCL%' AND u.ont_serial_scanned NOT LIKE 'ALCB%' AND u.ont_serial_scanned NOT LIKE 'GU18W%')
      OR (u.ups_serial_scanned IS NOT NULL AND u.ups_serial_scanned NOT LIKE 'GU18W%' AND u.ups_serial_scanned NOT LIKE 'ALCL%' AND u.ups_serial_scanned NOT LIKE 'ALCB%')
    )`);
  }

  // Resubmission filter - DRs that have been submitted more than once
  if (filters?.resubmissionsOnly) {
    conditions.push('u.submission_count > 1');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build queries - serials are in dr_photo_unified_reviews (synced from 1Map)
  const countQuery = `SELECT COUNT(*) FROM dr_photo_unified_reviews u ${whereClause}`;
  const dataQuery = `
    SELECT u.*,
      u.qa_phase,
      u.qa_decision,
      u.submission_count,
      COALESCE(u.submission_count, 1) > 1 as is_resubmission,
      (u.submission_history->0->>'photo_count')::int as previous_photo_count,
      oes.activation_date as oes_activation_date,
      oes.imported_at as oes_imported_at,
      EXISTS (
        SELECT 1 FROM oes_activations oes2
        WHERE oes2.drop_number = u.drop_number
      ) as is_activated,
      mt.id IS NOT NULL as has_maintenance_ticket,
      mt.ticket_uid as maintenance_ticket_uid
    FROM dr_photo_unified_reviews u
    LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number
    LEFT JOIN maintenance_tickets mt ON mt.dr_number = u.drop_number
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
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
    submission_count: row.submission_count || 1,
    is_resubmission: row.is_resubmission || false,
    previous_photo_count: row.previous_photo_count || null,
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
    `SELECT u.*,
      u.qa_phase,
      u.qa_decision,
      u.submission_count,
      COALESCE(u.submission_count, 1) > 1 as is_resubmission,
      (u.submission_history->0->>'photo_count')::int as previous_photo_count,
      oes.activation_date as oes_activation_date,
      oes.imported_at as oes_imported_at,
      EXISTS (
        SELECT 1 FROM oes_activations oes2
        WHERE oes2.drop_number = u.drop_number
      ) as is_activated,
      mt.id IS NOT NULL as has_maintenance_ticket,
      mt.ticket_uid as maintenance_ticket_uid
    FROM dr_photo_unified_reviews u
    LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number
    LEFT JOIN maintenance_tickets mt ON mt.dr_number = u.drop_number
    WHERE u.id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    ...row,
    is_complete: isDropComplete(row),
    steps_completed: countCompletedSteps(row),
    steps_total: 10,
    submission_count: row.submission_count || 1,
    is_resubmission: row.is_resubmission || false,
    previous_photo_count: row.previous_photo_count || null,
  };
}

/**
 * Get drop by drop number
 */
async function getDropByDropNumber(dropNumber: string): Promise<UnifiedDrop | null> {
  const result = await pool.query(
    `SELECT u.*,
      u.qa_phase,
      u.qa_decision,
      u.submission_count,
      COALESCE(u.submission_count, 1) > 1 as is_resubmission,
      (u.submission_history->0->>'photo_count')::int as previous_photo_count,
      oes.activation_date as oes_activation_date,
      oes.imported_at as oes_imported_at,
      EXISTS (
        SELECT 1 FROM oes_activations oes2
        WHERE oes2.drop_number = u.drop_number
      ) as is_activated,
      mt.id IS NOT NULL as has_maintenance_ticket,
      mt.ticket_uid as maintenance_ticket_uid
    FROM dr_photo_unified_reviews u
    LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number
    LEFT JOIN maintenance_tickets mt ON mt.dr_number = u.drop_number
    WHERE u.drop_number = $1`,
    [dropNumber]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    ...row,
    is_complete: isDropComplete(row),
    steps_completed: countCompletedSteps(row),
    steps_total: 10,
    submission_count: row.submission_count || 1,
    is_resubmission: row.is_resubmission || false,
    previous_photo_count: row.previous_photo_count || null,
  };
}

/**
 * Calculate summary statistics with optional filters
 *
 * CORRECTED LOGIC (Jan 2026) - Aligned with reportingService:
 * - totalDrops: INSTALLED + OES-only (all DRs in system for selected period)
 * - installed: Unique DRs from WhatsApp (first submission in date range)
 * - activated: DRs in OES report (activation_date in date range, independent)
 * - incomplete: DRs where vlm_categorization_status != 'approved'
 * - complete: DRs where vlm_categorization_status = 'approved'
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

  // Conditions for dr_photo_unified_reviews (INSTALLED)
  // IMPORTANT: Use submitted_date directly, NOT created_at fallback for INSTALLED count
  // OES-only records have submitted_date = NULL and should NOT be counted as "installed"
  const unifiedCond = buildConditions(
    'submitted_date',
    'project'
  );
  // Conditions for OES activations (ACTIVATED - independent date context)
  const oesCond = buildConditions('activation_date', 'upr.project');

  // Query 1: INSTALLED - DRs from WhatsApp (dr_photo_unified_reviews)
  // EXCLUDES OES-only records (is_oes_only = TRUE means no WhatsApp submission)
  // Also gets complete/incomplete counts based on vlm_categorization_status
  const installedQuery = `
    SELECT
      COUNT(*) as installed,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'approved') as complete,
      COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'pending' OR vlm_categorization_status IS NULL) as vlm_pending,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'processing') as vlm_processing,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'categorized' OR vlm_categorization_status = 'approved') as vlm_categorized,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'failed') as vlm_failed
    FROM dr_photo_unified_reviews
    ${unifiedCond.whereClause}${unifiedCond.whereClause ? ' AND' : ' WHERE'} (is_oes_only = FALSE OR is_oes_only IS NULL)
  `;

  // Query 2: ACTIVATED - DRs in OES filtered by OES activation_date (independent)
  // Falls back to drops table for project when no WA submission exists
  const activatedQuery = `
    SELECT COUNT(DISTINCT oes.drop_number) as activated
    FROM oes_activations oes
    LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      ${filters?.project && filters.project !== 'all' ? 'AND (upr.project = $3 OR p.project_name = $3)' : ''}
  `;
  const activatedParams = filters?.project && filters.project !== 'all'
    ? [filters.dateFrom || '1900-01-01', filters.dateTo || '2100-01-01', filters.project]
    : [filters?.dateFrom || '1900-01-01', filters?.dateTo || '2100-01-01'];

  // Query 3: OES-only count - activated but NOT in dr_photo_unified_reviews for this period
  // Falls back to drops table for project when no WA submission exists
  const oesOnlyQuery = `
    SELECT COUNT(DISTINCT oes.drop_number) as oes_only
    FROM oes_activations oes
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      AND NOT EXISTS (
        SELECT 1 FROM dr_photo_unified_reviews upr
        WHERE upr.drop_number = oes.drop_number
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
          ${filters?.project && filters.project !== 'all' ? 'AND upr.project = $3' : ''}
      )
      ${filters?.project && filters.project !== 'all' ? 'AND p.project_name = $3' : ''}
  `;

  // Run all queries in parallel
  const [installedResult, activatedResult, oesOnlyResult] = await Promise.all([
    pool.query(installedQuery, unifiedCond.params),
    pool.query(activatedQuery, activatedParams),
    pool.query(oesOnlyQuery, activatedParams),
  ]);

  const installedRow = installedResult.rows[0];
  const installed = parseInt(installedRow?.installed || '0', 10);
  const activated = parseInt(activatedResult.rows[0]?.activated || '0', 10);
  const oesOnly = parseInt(oesOnlyResult.rows[0]?.oes_only || '0', 10);

  // Total = INSTALLED + OES-only (all DRs in system for this period)
  let total = installed + oesOnly;
  // Reviewed = feedback_sent (QA has reviewed and sent feedback)
  let reviewed = parseInt(installedRow?.feedback_sent || '0', 10);
  let notReviewed = installed - reviewed;
  const feedbackSent = parseInt(installedRow?.feedback_sent || '0', 10);

  // Apply status filter to the results
  if (filters?.status === 'reviewed') {
    total = reviewed;
    notReviewed = 0;
  } else if (filters?.status === 'notReviewed') {
    total = notReviewed;
    reviewed = 0;
  }

  return {
    totalDrops: total,
    installed,
    activated,
    notReviewed: filters?.status === 'reviewed' ? 0 : (filters?.status === 'notReviewed' ? total : notReviewed),
    reviewed,
    totalFeedback: feedbackSent,
    // Legacy fields
    feedback_sent: feedbackSent,
    vlm_pending: parseInt(installedRow?.vlm_pending || '0', 10),
    vlm_processing: parseInt(installedRow?.vlm_processing || '0', 10),
    vlm_categorized: parseInt(installedRow?.vlm_categorized || '0', 10),
    vlm_failed: parseInt(installedRow?.vlm_failed || '0', 10),
  };
}

/**
 * Get project statistics with optional filtering
 *
 * CORRECTED LOGIC (Jan 2026) - Aligned with reportingService:
 * - total: INSTALLED + OES-only (all DRs for this project in period)
 * - installed: Unique DRs from WhatsApp (first submission in date range)
 * - activated: DRs in OES report (activation_date in range, independent)
 * - complete: vlm_categorization_status = 'approved'
 * - incomplete: installed - complete
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

  // Conditions based on unified table's submitted_date (first submission)
  // IMPORTANT: Use submitted_date directly - OES-only records have NULL submitted_date
  const unifiedCond = buildConditions('submitted_date', 'project');

  // Query 1: INSTALLED from dr_photo_unified_reviews with reviewed count
  // EXCLUDES OES-only records (is_oes_only = TRUE means no WhatsApp submission)
  // Reviewed = feedback_sent = true (QA has reviewed and sent feedback)
  const installedQuery = `
    SELECT
      COALESCE(project, 'Unknown') as project,
      COUNT(*) as installed,
      COUNT(*) FILTER (WHERE feedback_sent = true) as reviewed
    FROM dr_photo_unified_reviews
    ${unifiedCond.whereClause}${unifiedCond.whereClause ? ' AND' : ' WHERE'} (is_oes_only = FALSE OR is_oes_only IS NULL)
    GROUP BY COALESCE(project, 'Unknown')
  `;

  // Query 2: ACTIVATED - DRs in OES filtered by OES activation_date (independent)
  // Falls back to drops table for project when no WA submission exists
  const activatedParams = filters?.project && filters.project !== 'all'
    ? [filters?.dateFrom || '1900-01-01', filters?.dateTo || '2100-01-01', filters.project]
    : [filters?.dateFrom || '1900-01-01', filters?.dateTo || '2100-01-01'];

  const activatedQuery = `
    SELECT
      COALESCE(upr.project, p.project_name, 'Unknown') as project,
      COUNT(DISTINCT oes.drop_number) as activated
    FROM oes_activations oes
    LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      ${filters?.project && filters.project !== 'all' ? 'AND (upr.project = $3 OR p.project_name = $3 OR (upr.project IS NULL AND p.project_name IS NULL))' : ''}
    GROUP BY COALESCE(upr.project, p.project_name, 'Unknown')
  `;

  // Query 3: OES-only by project - activated but NOT installed in this period
  // Falls back to drops table for project when no WA submission exists
  const oesOnlyQuery = `
    SELECT
      COALESCE(upr.project, p.project_name, 'Unknown') as project,
      COUNT(DISTINCT oes.drop_number) as oes_only
    FROM oes_activations oes
    LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      AND NOT EXISTS (
        SELECT 1 FROM dr_photo_unified_reviews upr2
        WHERE upr2.drop_number = oes.drop_number
          AND COALESCE(upr2.submitted_date, upr2.created_at::DATE) >= $1::DATE
          AND COALESCE(upr2.submitted_date, upr2.created_at::DATE) <= $2::DATE
          ${filters?.project && filters.project !== 'all' ? 'AND upr2.project = $3' : ''}
      )
      ${filters?.project && filters.project !== 'all' ? 'AND (upr.project = $3 OR p.project_name = $3 OR (upr.project IS NULL AND p.project_name IS NULL))' : ''}
    GROUP BY COALESCE(upr.project, p.project_name, 'Unknown')
  `;

  // Run all queries in parallel
  const [installedResult, activatedResult, oesOnlyResult] = await Promise.all([
    pool.query(installedQuery, unifiedCond.params),
    pool.query(activatedQuery, activatedParams),
    pool.query(oesOnlyQuery, activatedParams),
  ]);

  // Merge results by project
  const projectMap = new Map<string, ProjectStats>();

  // Initialize from installed results
  for (const row of installedResult.rows) {
    const installed = parseInt(row.installed, 10);
    const reviewed = parseInt(row.reviewed, 10);
    projectMap.set(row.project, {
      project: row.project,
      total: installed, // Will add OES-only below
      installed,
      activated: 0,
      reviewed,
      notReviewed: installed - reviewed,
    });
  }

  // Add activated counts
  for (const row of activatedResult.rows) {
    const existing = projectMap.get(row.project);
    if (existing) {
      existing.activated = parseInt(row.activated, 10);
    } else {
      projectMap.set(row.project, {
        project: row.project,
        total: 0, // Will add OES-only below
        installed: 0,
        activated: parseInt(row.activated, 10),
        reviewed: 0,
        notReviewed: 0,
      });
    }
  }

  // Add OES-only to total
  for (const row of oesOnlyResult.rows) {
    const oesOnly = parseInt(row.oes_only, 10);
    const existing = projectMap.get(row.project);
    if (existing) {
      existing.total += oesOnly;
    } else {
      projectMap.set(row.project, {
        project: row.project,
        total: oesOnly,
        installed: 0,
        activated: oesOnly, // OES-only means they're all activated
        reviewed: 0,
        notReviewed: 0,
      });
    }
  }

  // Convert to array and sort by total descending
  const stats = Array.from(projectMap.values());

  // Apply status filter
  if (filters?.status === 'reviewed') {
    return stats
      .filter((s) => s.reviewed > 0)
      .map((s) => ({ ...s, total: s.reviewed, notReviewed: 0 }))
      .sort((a, b) => b.total - a.total);
  } else if (filters?.status === 'notReviewed') {
    return stats
      .filter((s) => s.notReviewed > 0)
      .map((s) => ({ ...s, total: s.notReviewed, reviewed: 0 }))
      .sort((a, b) => b.total - a.total);
  }

  return stats.sort((a, b) => b.total - a.total);
}

/**
 * Get all active projects for the filter dropdown
 * Returns projects that have WhatsApp group mappings (active projects)
 */
async function getActiveProjects(): Promise<string[]> {
  // Get projects that have DR data OR are in the known project mappings
  const result = await pool.query(`
    SELECT DISTINCT project_name
    FROM (
      -- Projects from unified reviews
      SELECT DISTINCT project as project_name
      FROM dr_photo_unified_reviews
      WHERE project IS NOT NULL AND project != ''

      UNION

      -- Active projects from projects table
      SELECT project_name
      FROM projects
      WHERE project_name IS NOT NULL AND project_name != ''
    ) combined
    ORDER BY project_name
  `);

  return result.rows.map((row: any) => row.project_name);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  try {
    const { id, dropNumber, search, page, skipSummary, dateFrom, dateTo, project, status, qaStatus, serialStatus, resubmissionsOnly } = req.query;

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
      qaStatus: qaStatus && typeof qaStatus === 'string' ? qaStatus : undefined,
      serialStatus: serialStatus && typeof serialStatus === 'string' ? serialStatus : undefined,
      resubmissionsOnly: resubmissionsOnly === 'true',
    };

    const searchTerm = search && typeof search === 'string' ? search : undefined;

    // Run all queries in parallel for faster response
    const [result, summary, projectStats, activeProjects] = await Promise.all([
      getPaginatedDrops(currentPage, pageSize, searchTerm, filters),
      skipSummary === 'true' ? Promise.resolve(null) : calculateSummary(filters),
      getProjectStats(filters),
      getActiveProjects(),
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
      activeProjects,
      pagination: result.pagination,
      meta: {
        timestamp: new Date().toISOString(),
        filters: (filters.dateFrom || filters.dateTo || filters.project || filters.status || filters.qaStatus || filters.resubmissionsOnly) ? filters : null,
      },
    });
  } catch (error: any) {
    log.error('DrPhotoUnifiedDropsAPI', 'Error fetching drops', error);
    return apiResponse.internalError(res, error);
  }
}
