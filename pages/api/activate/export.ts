/**
 * Activate Module - Excel Export API
 * GET /api/activate/export
 *
 * Exports filtered DR data to Excel format (.xlsx)
 * Respects same filters as Dashboard/QA Centre: dateFrom, dateTo, project, status
 *
 * Includes:
 * - DR details (drop_number, project, photo_count)
 * - Step completion status (10 steps)
 * - VLM categorization results
 * - Agent/sender info from WhatsApp
 * - OES activation data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';

import * as XLSX from 'xlsx';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';

// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface ExportRow {
  drop_number: string;
  project: string;
  submitted_date: string;
  photo_count: number;
  steps_completed: number;
  is_complete: boolean;
  // Step details
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
  // VLM status
  vlm_status: string;
  feedback_sent: boolean;
  // Serials (scanned from photos)
  ont_serial_scanned: string | null;
  ups_serial_scanned: string | null;
  // Agent info from WhatsApp
  sender_phone: string | null;
  sender_name: string | null;
  assigned_agent: string | null;
  // OES activation
  activation_date: string | null;
  activated: boolean;
}

/**
 * Count completed steps
 */
function countCompletedSteps(row: any): number {
  let count = 0;
  if (row.step_01_house_photo) count++;
  if (row.step_02_cable_from_pole) count++;
  if (row.step_03_entry_outside) count++;
  if (row.step_04_entry_inside) count++;
  if (row.step_05_wall) count++;
  if (row.step_06_ont_back) count++;
  if (row.step_07_power_meter) count++;
  if (row.step_08_final_installation) count++;
  if (row.step_09_green_lights) count++;
  if (row.step_10_signature) count++;
  return count;
}

/**
 * Check if all steps complete
 */
function isComplete(row: any): boolean {
  return (
    row.step_01_house_photo &&
    row.step_02_cable_from_pole &&
    row.step_03_entry_outside &&
    row.step_04_entry_inside &&
    row.step_05_wall &&
    row.step_06_ont_back &&
    row.step_07_power_meter &&
    row.step_08_final_installation &&
    row.step_09_green_lights &&
    row.step_10_signature
  );
}

/**
 * Convert rows to Excel workbook
 */
function toExcel(rows: ExportRow[]): Buffer {
  // Define column headers
  const headers = [
    'DR Number',
    'Project',
    'Submitted Date',
    'Photo Count',
    'Steps Completed',
    'Is Complete',
    'Step 1: House Photo',
    'Step 2: Cable from Pole',
    'Step 3: Entry Outside',
    'Step 4: Entry Inside',
    'Step 5: Wall',
    'Step 6: ONT Back',
    'Step 7: Power Meter',
    'Step 8: Final Installation',
    'Step 9: Green Lights',
    'Step 10: Signature',
    'VLM Status',
    'Feedback Sent',
    'ONT Serial',
    'UPS Serial',
    'Sender Phone',
    'Sender Name',
    'Assigned Agent',
    'Activation Date',
    'Activated',
  ];

  // Convert rows to array of arrays
  const data = rows.map((row) => [
    row.drop_number,
    row.project,
    row.submitted_date,
    row.photo_count,
    row.steps_completed,
    row.is_complete ? 'Yes' : 'No',
    row.step_01_house_photo ? 'Yes' : 'No',
    row.step_02_cable_from_pole ? 'Yes' : 'No',
    row.step_03_entry_outside ? 'Yes' : 'No',
    row.step_04_entry_inside ? 'Yes' : 'No',
    row.step_05_wall ? 'Yes' : 'No',
    row.step_06_ont_back ? 'Yes' : 'No',
    row.step_07_power_meter ? 'Yes' : 'No',
    row.step_08_final_installation ? 'Yes' : 'No',
    row.step_09_green_lights ? 'Yes' : 'No',
    row.step_10_signature ? 'Yes' : 'No',
    row.vlm_status || '',
    row.feedback_sent ? 'Yes' : 'No',
    row.ont_serial_scanned || '',
    row.ups_serial_scanned || '',
    row.sender_phone || '',
    row.sender_name || '',
    row.assigned_agent || '',
    row.activation_date || '',
    row.activated ? 'Yes' : 'No',
  ]);

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws['!cols'] = [
    { wch: 12 }, // DR Number
    { wch: 10 }, // Project
    { wch: 12 }, // Submitted Date
    { wch: 8 }, // Photo Count
    { wch: 10 }, // Steps Completed
    { wch: 10 }, // Is Complete
    { wch: 8 }, // Steps 1-10
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 }, // VLM Status
    { wch: 10 }, // Feedback Sent
    { wch: 18 }, // ONT Serial
    { wch: 18 }, // UPS Serial
    { wch: 15 }, // Sender Phone
    { wch: 15 }, // Sender Name
    { wch: 15 }, // Assigned Agent
    { wch: 12 }, // Activation Date
    { wch: 10 }, // Activated
  ];

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Activate Export');

  // Write to buffer
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { dateFrom, dateTo, project, status, format } = req.query;

    // Build filter conditions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (dateFrom && typeof dateFrom === 'string') {
      conditions.push(`COALESCE(upr.submitted_date, upr.created_at::DATE) >= $${paramIndex}::DATE`);
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo && typeof dateTo === 'string') {
      conditions.push(`COALESCE(upr.submitted_date, upr.created_at::DATE) <= $${paramIndex}::DATE`);
      params.push(dateTo);
      paramIndex++;
    }
    if (project && typeof project === 'string' && project !== 'all') {
      conditions.push(`upr.project = $${paramIndex}`);
      params.push(project);
      paramIndex++;
    }

    // Status filter (complete/incomplete)
    const isCompleteCondition = `
      upr.step_01_house_photo AND upr.step_02_cable_from_pole AND upr.step_03_entry_outside AND
      upr.step_04_entry_inside AND upr.step_05_wall AND upr.step_06_ont_back AND
      upr.step_07_power_meter AND upr.step_08_final_installation AND upr.step_09_green_lights AND
      upr.step_10_signature
    `;

    if (status === 'complete') {
      conditions.push(`(${isCompleteCondition})`);
    } else if (status === 'incomplete') {
      conditions.push(`NOT (${isCompleteCondition})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query to get all export data with JOINs
    const query = `
      SELECT
        upr.drop_number,
        upr.project,
        COALESCE(upr.submitted_date::TEXT, upr.created_at::DATE::TEXT) as submitted_date,
        upr.photo_count,
        upr.step_01_house_photo,
        upr.step_02_cable_from_pole,
        upr.step_03_entry_outside,
        upr.step_04_entry_inside,
        upr.step_05_wall,
        upr.step_06_ont_back,
        upr.step_07_power_meter,
        upr.step_08_final_installation,
        upr.step_09_green_lights,
        upr.step_10_signature,
        upr.vlm_categorization_status as vlm_status,
        upr.feedback_sent,
        -- Serials (scanned from photos)
        upr.ont_serial_scanned,
        upr.ups_serial_scanned,
        -- Sender info from unified reviews or qa_photo_reviews
        COALESCE(upr.sender_phone, qpr.sender_phone) as sender_phone,
        qpr.user_name as sender_name,
        qpr.assigned_agent,
        -- OES activation data
        oes.activation_date::TEXT as activation_date,
        CASE WHEN oes.drop_number IS NOT NULL THEN true ELSE false END as activated
      FROM dr_photo_unified_reviews upr
      LEFT JOIN (
        SELECT DISTINCT ON (drop_number) *
        FROM qa_photo_reviews
        ORDER BY drop_number, created_at DESC
      ) qpr ON qpr.drop_number = upr.drop_number
      LEFT JOIN oes_activations oes ON oes.drop_number = upr.drop_number
      ${whereClause}
      ORDER BY upr.submitted_date DESC NULLS LAST, upr.created_at DESC
    `;

    const result = await pool.query(query, params);

    // Transform rows with calculated fields
    const rows: ExportRow[] = result.rows.map((row) => ({
      ...row,
      steps_completed: countCompletedSteps(row),
      is_complete: isComplete(row),
    }));

    log.info('ActivateExportAPI', `Exporting ${rows.length} rows`, {
      dateFrom,
      dateTo,
      project,
      status,
    });

    // Return as JSON if format=json requested
    if (format === 'json') {
      return res.status(200).json({
        success: true,
        data: rows,
        meta: {
          count: rows.length,
          filters: { dateFrom, dateTo, project, status },
          exportedAt: new Date().toISOString(),
        },
      });
    }

    // Return as Excel file download (default)
    const excel = toExcel(rows);
    const filename = `activate-export-${dateFrom || 'all'}-to-${dateTo || 'all'}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(excel);
  } catch (error: any) {
    log.error('ActivateExportAPI', 'Error exporting data', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to export data',
    });
  }
}

export default withAuth(withRole('manager')(handler));
