/**
 * Activate Module - CSV Export API
 * GET /api/activate/export
 *
 * Exports filtered DR data to CSV format
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
import ws from 'ws';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

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
  // OneMap serials
  onemap_ont_serial: string | null;
  onemap_ups_serial: string | null;
  // Agent info from WhatsApp
  sender_phone: string | null;
  sender_name: string | null;
  assigned_agent: string | null;
  // OES activation
  activation_date: string | null;
  activated: boolean;
}

/**
 * Escape CSV field - handles commas, quotes, newlines
 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If contains comma, quote, or newline, wrap in quotes and escape existing quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert rows to CSV string
 */
function toCSV(rows: ExportRow[]): string {
  if (rows.length === 0) return '';

  // Define column headers and their display names
  const columns: { key: keyof ExportRow; header: string }[] = [
    { key: 'drop_number', header: 'DR Number' },
    { key: 'project', header: 'Project' },
    { key: 'submitted_date', header: 'Submitted Date' },
    { key: 'photo_count', header: 'Photo Count' },
    { key: 'steps_completed', header: 'Steps Completed' },
    { key: 'is_complete', header: 'Is Complete' },
    { key: 'step_01_house_photo', header: 'Step 1: House Photo' },
    { key: 'step_02_cable_from_pole', header: 'Step 2: Cable from Pole' },
    { key: 'step_03_entry_outside', header: 'Step 3: Entry Outside' },
    { key: 'step_04_entry_inside', header: 'Step 4: Entry Inside' },
    { key: 'step_05_wall', header: 'Step 5: Wall' },
    { key: 'step_06_ont_back', header: 'Step 6: ONT Back' },
    { key: 'step_07_power_meter', header: 'Step 7: Power Meter' },
    { key: 'step_08_final_installation', header: 'Step 8: Final Installation' },
    { key: 'step_09_green_lights', header: 'Step 9: Green Lights' },
    { key: 'step_10_signature', header: 'Step 10: Signature' },
    { key: 'vlm_status', header: 'VLM Status' },
    { key: 'feedback_sent', header: 'Feedback Sent' },
    { key: 'onemap_ont_serial', header: 'ONT Serial' },
    { key: 'onemap_ups_serial', header: 'UPS Serial' },
    { key: 'sender_phone', header: 'Sender Phone' },
    { key: 'sender_name', header: 'Sender Name' },
    { key: 'assigned_agent', header: 'Assigned Agent' },
    { key: 'activation_date', header: 'Activation Date' },
    { key: 'activated', header: 'Activated' },
  ];

  // Create header row
  const headerRow = columns.map((c) => c.header).join(',');

  // Create data rows
  const dataRows = rows.map((row) =>
    columns.map((c) => escapeCSV(row[c.key])).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        -- OneMap serials from foto_ai_reviews
        fai.onemap_ont_serial,
        fai.onemap_ups_serial,
        -- Sender info from foto_ai_reviews or qa_photo_reviews
        COALESCE(fai.sender_phone, qpr.sender_phone) as sender_phone,
        qpr.user_name as sender_name,
        qpr.assigned_agent,
        -- OES activation data
        oes.activation_date::TEXT as activation_date,
        CASE WHEN oes.drop_number IS NOT NULL THEN true ELSE false END as activated
      FROM dr_photo_unified_reviews upr
      LEFT JOIN foto_ai_reviews fai ON fai.dr_number = upr.drop_number
      LEFT JOIN (
        SELECT DISTINCT ON (drop_number) *
        FROM qa_photo_reviews
        ORDER BY drop_number, submitted_at DESC
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

    // Return as CSV file download
    if (format !== 'json') {
      const csv = toCSV(rows);
      const filename = `activate-export-${dateFrom || 'all'}-to-${dateTo || 'all'}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }

    // Return as JSON if format=json requested
    return res.status(200).json({
      success: true,
      data: rows,
      meta: {
        count: rows.length,
        filters: { dateFrom, dateTo, project, status },
        exportedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    log.error('ActivateExportAPI', 'Error exporting data', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to export data',
    });
  }
}
