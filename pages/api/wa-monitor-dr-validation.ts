/**
 * WA Monitor DR Validation API (Enhanced for Janice's format)
 * POST /api/wa-monitor-dr-validation - Upload CSV/Excel and validate against database
 * GET /api/wa-monitor-dr-validation?project={project}&date={date} - Get drops for project/date
 * DELETE /api/wa-monitor-dr-validation?id={id} - Delete a drop record
 * PUT /api/wa-monitor-dr-validation - Add missing drop records
 *
 * Handles DR number validation and reconciliation for Janice
 * Supports CSV and Excel (.xlsx) file uploads
 * Enhanced: Handles Excel time decimals + multi-project Excel files
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const sql = neon(process.env.DATABASE_URL || '');

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

interface CsvRow {
  date: string;
  dropNumber: string;
  time: string;
}

interface ValidationResult {
  inCsvAndDb: CsvRow[];
  inCsvNotInDb: CsvRow[];
  inDbNotInCsv: any[];
  csvTotal: number;
  dbTotal: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // GET - Fetch drops for a project/date
  if (req.method === 'GET') {
    try {
      const { project, date } = req.query;

      if (!project || !date) {
        return apiResponse.validationError(res, {
          project: 'Project is required',
          date: 'Date is required',
        });
      }

      // Fetch drops from database for this project and date
      const drops = await sql`
        SELECT
          id,
          drop_number as "dropNumber",
          DATE(created_at) as date,
          TO_CHAR(created_at, 'HH24:MI') as time,
          project,
          completed,
          incomplete
        FROM qa_photo_reviews
        WHERE project = ${project as string}
          AND DATE(created_at) = ${date as string}
        ORDER BY created_at ASC
      `;

      return apiResponse.success(res, { drops, total: drops.length });
    } catch (error: any) {
      console.error('Error fetching drops:', error);
      return apiResponse.internalError(res, error, 'Failed to fetch drops');
    }
  }

  // POST - Upload CSV and validate
  if (req.method === 'POST') {
    try {
      // Parse multipart form data
      const form = formidable({
        maxFileSize: 5 * 1024 * 1024, // 5MB
      });

      const [fields, files] = await form.parse(req);
      const project = fields.project?.[0];
      const date = fields.date?.[0];

      if (!project || !date) {
        return apiResponse.validationError(res, {
          project: 'Project is required',
          date: 'Date is required',
        });
      }

      const uploadedFile = files.file?.[0];
      if (!uploadedFile) {
        return apiResponse.validationError(res, {
          file: 'CSV or Excel file is required',
        });
      }

      // Determine file type
      const fileExtension = uploadedFile.originalFilename?.split('.').pop()?.toLowerCase();
      let parsedData: any[] = [];

      // Parse based on file type
      if (fileExtension === 'csv') {
        // Parse CSV
        const fileContent = fs.readFileSync(uploadedFile.filepath, 'utf-8');
        const parseResult = Papa.parse<any>(fileContent, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => {
            // Normalize headers
            const lower = header.toLowerCase().trim();
            if (lower === 'date') return 'date';
            if (lower.includes('dr') && lower.includes('nr')) return 'dropNumber';
            if (lower === 'time') return 'time';
            return header;
          },
        });

        if (parseResult.errors.length > 0) {
          return apiResponse.validationError(res, {
            csv: 'CSV parsing error: ' + parseResult.errors[0].message,
          });
        }

        parsedData = parseResult.data;
      } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Parse Excel (Enhanced for Janice's multi-project format)
        const fileBuffer = fs.readFileSync(uploadedFile.filepath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Get raw array data (includes row 0 with project names, row 1 with headers)
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        // Detect project sections and extract data
        parsedData = extractProjectDataFromExcel(rawData as any[][], project as string);

        if (parsedData.length === 0) {
          return apiResponse.validationError(res, {
            file: `No data found for project "${project}". Available projects might be in different columns.`,
          });
        }
      } else {
        return apiResponse.validationError(res, {
          file: 'Unsupported file type. Please upload CSV or Excel (.xlsx) file',
        });
      }

      // Extract and normalize data
      const csvRows: CsvRow[] = parsedData
        .map((row: any) => ({
          date: normalizeDate(row.date, date as string),
          dropNumber: normalizeDropNumber(row.dropNumber),
          time: normalizeTime(row.time),
        }))
        .filter((row) => row.dropNumber); // Remove rows without DR numbers

      // Get all drop numbers from CSV
      const csvDropNumbers = csvRows.map((r) => r.dropNumber);

      // Fetch drops from database for this project and date
      const dbDrops = await sql`
        SELECT
          id,
          drop_number as "dropNumber",
          DATE(created_at) as date,
          TO_CHAR(created_at, 'HH24:MI') as time,
          project,
          completed,
          incomplete
        FROM qa_photo_reviews
        WHERE project = ${project as string}
          AND DATE(created_at) = ${date as string}
      `;

      const dbDropNumbers = dbDrops.map((d) => d.dropNumber);

      // Compare: In CSV and in DB
      const inCsvAndDb = csvRows.filter((csv) =>
        dbDropNumbers.includes(csv.dropNumber)
      );

      // Compare: In CSV but NOT in DB (missing from DB)
      const inCsvNotInDb = csvRows.filter(
        (csv) => !dbDropNumbers.includes(csv.dropNumber)
      );

      // Compare: In DB but NOT in CSV (extra in DB)
      const inDbNotInCsv = dbDrops.filter(
        (db) => !csvDropNumbers.includes(db.dropNumber)
      );

      const result: ValidationResult = {
        inCsvAndDb,
        inCsvNotInDb,
        inDbNotInCsv,
        csvTotal: csvRows.length,
        dbTotal: dbDrops.length,
      };

      return apiResponse.success(res, result);
    } catch (error: any) {
      console.error('Error validating CSV:', error);
      return apiResponse.internalError(res, error, 'Failed to validate CSV');
    }
  }

  // PUT - Add missing drop records
  if (req.method === 'PUT') {
    try {
      const { drops, project } = req.body;

      if (!drops || !Array.isArray(drops) || drops.length === 0) {
        return apiResponse.validationError(res, {
          drops: 'Drops array is required',
        });
      }

      if (!project) {
        return apiResponse.validationError(res, {
          project: 'Project is required',
        });
      }

      // Insert drops in batch
      const insertedIds: string[] = [];
      for (const drop of drops) {
        const { date, dropNumber, time } = drop;

        // Create timestamp from date and time
        const timestamp = time
          ? `${date} ${time}:00`
          : `${date} 00:00:00`;

        const [result] = await sql`
          INSERT INTO qa_photo_reviews (
            drop_number,
            project,
            created_at,
            updated_at,
            review_date,
            user_name,
            completed_photos,
            outstanding_photos,
            outstanding_photos_loaded_to_1map,
            completed,
            incomplete
          ) VALUES (
            ${dropNumber},
            ${project},
            ${timestamp}::timestamp,
            ${timestamp}::timestamp,
            ${date}::date,
            'Manual Entry',
            0,
            12,
            false,
            false,
            true
          )
          ON CONFLICT (drop_number) DO NOTHING
          RETURNING id
        `;

        if (result?.id) {
          insertedIds.push(result.id);
        }
      }

      return apiResponse.created(res, {
        inserted: insertedIds.length,
        ids: insertedIds,
      }, `${insertedIds.length} drop(s) added successfully`);
    } catch (error: any) {
      console.error('Error adding drops:', error);
      return apiResponse.internalError(res, error, 'Failed to add drops');
    }
  }

  // DELETE - Remove a drop record
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;

      if (!id || typeof id !== 'string') {
        return apiResponse.validationError(res, {
          id: 'Drop ID is required',
        });
      }

      const [deleted] = await sql`
        DELETE FROM qa_photo_reviews
        WHERE id = ${id}
        RETURNING id
      `;

      if (!deleted) {
        return apiResponse.notFound(res, 'Drop', id);
      }

      return apiResponse.success(res, { deleted: true, id });
    } catch (error: any) {
      console.error('Error deleting drop:', error);
      return apiResponse.internalError(res, error, 'Failed to delete drop');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', [
    'GET',
    'POST',
    'PUT',
    'DELETE',
  ]);
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Extract data for a specific project from Excel file
 * Supports two formats:
 * 1. Simple Format: Row 0 = headers ("Date", "DR nr", "Time"), Row 1+ = data
 * 2. Multi-Project Format: Row 0 = project names, Row 1 = headers, Row 2+ = data
 */
function extractProjectDataFromExcel(rawData: any[][], projectName: string): any[] {
  if (rawData.length < 2) return []; // Need at least headers and one data row

  // Detect format by checking if row 0 contains headers or project names
  const firstRow = rawData[0];
  const isSimpleFormat = isHeaderRow(firstRow);

  if (isSimpleFormat) {
    // Simple Format: Row 0 = headers, Row 1+ = data
    return extractSimpleFormat(rawData);
  } else {
    // Multi-Project Format: Row 0 = project names, Row 1 = headers, Row 2+ = data
    return extractMultiProjectFormat(rawData, projectName);
  }
}

/**
 * Check if a row contains headers (Date, DR nr, Time) instead of project names
 */
function isHeaderRow(row: any[]): boolean {
  if (!row || row.length < 2) return false;

  let hasDate = false;
  let hasDR = false;

  for (const cell of row) {
    if (cell && typeof cell === 'string') {
      const lower = cell.toLowerCase().trim();
      if (lower === 'date') hasDate = true;
      if (lower.includes('dr') && lower.includes('nr')) hasDR = true;
    }
  }

  return hasDate && hasDR;
}

/**
 * Extract data from simple format (headers in row 0, data in row 1+)
 */
function extractSimpleFormat(rawData: any[][]): any[] {
  const headerRow = rawData[0];

  // Find column indices
  let dateCol = -1, drCol = -1, timeCol = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i];
    if (header && typeof header === 'string') {
      const lower = header.toLowerCase().trim();
      if (lower === 'date' && dateCol === -1) dateCol = i;
      else if (lower.includes('dr') && lower.includes('nr') && drCol === -1) drCol = i;
      else if (lower === 'time' && timeCol === -1) timeCol = i;
    }
  }

  if (dateCol === -1 || drCol === -1) {
    return []; // Required columns not found
  }

  // Extract data rows (start from row 1)
  const results: any[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const dateValue = row[dateCol];
    const drValue = row[drCol];
    const timeValue = timeCol !== -1 ? row[timeCol] : null;

    // Only include rows with valid DR number
    if (drValue) {
      results.push({
        date: dateValue,
        dropNumber: drValue,
        time: timeValue,
      });
    }
  }

  return results;
}

/**
 * Extract data from multi-project format (project names in row 0, headers in row 1, data in row 2+)
 */
function extractMultiProjectFormat(rawData: any[][], projectName: string): any[] {
  if (rawData.length < 3) return []; // Need at least: row 0 (projects), row 1 (headers), row 2 (data)

  const projectRow = rawData[0]; // Row with project names
  const headerRow = rawData[1];  // Row with "Date", "DR nr", "Time"

  // Find which column group contains this project
  let projectColumnStart = -1;
  for (let i = 0; i < projectRow.length; i++) {
    const cellValue = projectRow[i];
    if (cellValue && typeof cellValue === 'string') {
      const normalized = cellValue.trim();
      // Match project name (case-insensitive, partial match)
      if (normalized.toLowerCase().includes(projectName.toLowerCase()) ||
        projectName.toLowerCase().includes(normalized.toLowerCase())) {
        projectColumnStart = i;
        break;
      }
    }
  }

  if (projectColumnStart === -1) {
    return []; // Project not found
  }

  // Find the columns for Date, DR nr, Time starting from projectColumnStart
  let dateCol = -1, drCol = -1, timeCol = -1;
  for (let i = projectColumnStart; i < Math.min(projectColumnStart + 5, headerRow.length); i++) {
    const header = headerRow[i];
    if (header && typeof header === 'string') {
      const lower = header.toLowerCase().trim();
      if (lower === 'date' && dateCol === -1) dateCol = i;
      else if (lower.includes('dr') && lower.includes('nr') && drCol === -1) drCol = i;
      else if (lower === 'time' && timeCol === -1) timeCol = i;
    }
  }

  if (dateCol === -1 || drCol === -1) {
    return []; // Required columns not found
  }

  // Extract data rows (skip row 0 and 1)
  const results: any[] = [];
  for (let i = 2; i < rawData.length; i++) {
    const row = rawData[i];
    const dateValue = row[dateCol];
    const drValue = row[drCol];
    const timeValue = timeCol !== -1 ? row[timeCol] : null;

    // Only include rows with valid DR number
    if (drValue) {
      results.push({
        date: dateValue,
        dropNumber: drValue,
        time: timeValue,
      });
    }
  }

  return results;
}

/**
 * Convert Excel time value to HH:MM format
 * Excel stores time as decimal: 0.5 = 12:00, 0.376 = 9:01
 */
function normalizeTime(input: any): string {
  if (!input) return '';

  // If already a string (HH:MM format), return as-is
  if (typeof input === 'string') {
    return input;
  }

  // If it's a number (Excel time decimal), convert it
  if (typeof input === 'number') {
    const totalMinutes = Math.round(input * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  return '';
}

/**
 * Normalize drop number to DR######## format
 * Handles: DR1733545, Dr1733545, dr1733545, 1733545
 */
function normalizeDropNumber(input: string): string {
  if (!input) return '';

  const cleaned = input.toString().trim().toUpperCase();

  // Already in correct format
  if (/^DR\d{7,8}$/.test(cleaned)) {
    return cleaned;
  }

  // Extract numbers only
  const numbers = cleaned.replace(/[^\d]/g, '');

  // Must have at least 7 digits
  if (numbers.length >= 7) {
    return `DR${numbers}`;
  }

  return cleaned; // Return as-is if can't normalize
}

/**
 * Normalize date to YYYY-MM-DD format
 * Handles: 25/11/2025, 2025-11-25, Excel date numbers
 */
function normalizeDate(input: any, fallback: string): string {
  if (!input) return fallback;

  // Handle Excel date numbers (e.g., 45620 = 2024-11-25)
  if (typeof input === 'number') {
    const excelEpoch = new Date(1899, 11, 30); // Excel epoch
    const date = new Date(excelEpoch.getTime() + input * 86400000);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const inputStr = input.toString();

  // Try DD/MM/YYYY format
  const ddmmyyyy = inputStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month}-${day}`;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(inputStr)) {
    return inputStr;
  }

  return fallback;
}

export default withAuth(handler);
