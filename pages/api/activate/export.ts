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
import { Pool } from 'pg';

import * as XLSX from 'xlsx';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
    const { dateFrom, dateTo, project, status, qaStatus, serialStatus, resubmissionsOnly, format } = req.query;

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

    // Status filter - MUST match drops.ts logic exactly
    // installed: DRs from WhatsApp that are NOT in OES activations
    // activated: DRs that ARE in OES activations
    // reviewed: feedback_sent = true
    // not_reviewed: feedback_sent is null or false
    if (status === 'installed') {
      conditions.push(`NOT EXISTS (SELECT 1 FROM oes_activations oes2 WHERE oes2.drop_number = upr.drop_number)`);
    } else if (status === 'activated') {
      conditions.push(`EXISTS (SELECT 1 FROM oes_activations oes2 WHERE oes2.drop_number = upr.drop_number)`);
    } else if (status === 'not_reviewed' || status === 'notReviewed') {
      conditions.push(`(upr.feedback_sent IS NULL OR upr.feedback_sent = false)`);
    } else if (status === 'reviewed') {
      conditions.push(`upr.feedback_sent = true`);
    }

    // QA Status filter - MUST match drops.ts logic exactly
    // DB stores: PASS, FAIL, REWORK_NEEDED (not passed/failed/rework)
    if (qaStatus && typeof qaStatus === 'string' && qaStatus !== 'all') {
      if (qaStatus === 'pending') {
        conditions.push(`(upr.qa_decision IS NULL)`);
      } else if (qaStatus === 'passed') {
        conditions.push(`upr.qa_decision = 'PASS'`);
      } else if (qaStatus === 'failed') {
        conditions.push(`upr.qa_decision = 'FAIL'`);
      } else if (qaStatus === 'rework') {
        conditions.push(`upr.qa_decision = 'REWORK_NEEDED'`);
      }
    }

    // Serial Status filter - MUST match drops.ts pattern-based logic exactly
    if (serialStatus && typeof serialStatus === 'string' && serialStatus !== 'all') {
      if (serialStatus === 'valid') {
        conditions.push(`(
          upr.ont_serial_scanned IS NOT NULL
          AND upr.ups_serial_scanned IS NOT NULL
          AND (upr.ont_serial_scanned LIKE 'ALCL%' OR upr.ont_serial_scanned LIKE 'ALCB%')
          AND upr.ups_serial_scanned LIKE 'GU18W%'
        )`);
      } else if (serialStatus === 'swapped') {
        conditions.push(`(
          (upr.ont_serial_scanned LIKE 'GU18W%')
          OR (upr.ups_serial_scanned LIKE 'ALCL%' OR upr.ups_serial_scanned LIKE 'ALCB%')
        )`);
      } else if (serialStatus === 'missing') {
        conditions.push(`(upr.ont_serial_scanned IS NULL OR upr.ups_serial_scanned IS NULL)`);
      } else if (serialStatus === 'invalid') {
        conditions.push(`(
          (upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned NOT LIKE 'ALCL%' AND upr.ont_serial_scanned NOT LIKE 'ALCB%' AND upr.ont_serial_scanned NOT LIKE 'GU18W%')
          OR (upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned NOT LIKE 'GU18W%' AND upr.ups_serial_scanned NOT LIKE 'ALCL%' AND upr.ups_serial_scanned NOT LIKE 'ALCB%')
        )`);
      }
    }

    // Resubmissions only
    if (resubmissionsOnly === 'true') {
      conditions.push(`upr.submission_count > 1`);
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
    // Build descriptive filename with active filters
    const filenameParts: string[] = ['activate-export'];
    if (project && project !== 'all') filenameParts.push(String(project).replace(/\s+/g, '-'));
    if (status && status !== 'all') filenameParts.push(String(status));
    if (qaStatus && qaStatus !== 'all') filenameParts.push(`qa-${qaStatus}`);
    if (serialStatus && serialStatus !== 'all') filenameParts.push(`serial-${serialStatus}`);
    if (resubmissionsOnly === 'true') filenameParts.push('resubmissions');
    if (dateFrom) filenameParts.push(String(dateFrom));
    if (dateTo) filenameParts.push(`to-${dateTo}`);
    filenameParts.push(`${rows.length}-records`);
    if (filenameParts.length === 2) filenameParts.splice(1, 0, 'all'); // 'all' before count
    const filename = `${filenameParts.join('-')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
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
