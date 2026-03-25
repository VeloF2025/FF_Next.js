/**
 * Unified Import Service for Project Data
 * PRD-047: Main import logic for drops, poles, and fibre
 */

import { log } from '@/lib/logger';
import { Client } from 'pg';
import {
  DataType,
  ImportError,
  ImportOptions,
  ImportResult,
  ImportStats,
  ValidationResult,
} from './types';
import { getMapping } from './mappings';
import { hasRequiredIdentifier, validateDataset, validateRow } from './validators';

/**
 * Create a PostgreSQL client
 */
async function createClient(): Promise<Client> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not configured');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

const DEFAULT_OPTIONS: ImportOptions = {
  clearExisting: false,
  validateOnly: false,
  batchSize: 500,
  skipInvalid: false,
};

/**
 * Parse Excel file from base64 or buffer
 */
export async function parseExcelFile(
  data: string | Buffer,
  sheetName?: string
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, {
    type: typeof data === 'string' ? 'base64' : 'buffer',
    cellDates: true,
    cellNF: true,
  });

  // Get sheet - use provided name or first sheet
  const firstSheetName = workbook.SheetNames[0];
  const targetSheetName = sheetName || firstSheetName;
  const sheet = targetSheetName ? workbook.Sheets[targetSheetName] : undefined;

  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName || 'first sheet'}`);
  }

  // Convert to JSON with header row
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  // Extract headers from first row keys
  const firstRow = jsonData[0];
  const headers = firstRow ? Object.keys(firstRow) : [];

  return { headers, rows: jsonData };
}

/**
 * Detect data type from Excel headers
 */
export function detectDataType(headers: string[]): DataType | null {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Drops: has 'label' with DR pattern, or drop_number
  if (
    normalizedHeaders.includes('label') ||
    normalizedHeaders.includes('drop_number') ||
    normalizedHeaders.some(h => h.includes('endfeat') || h.includes('end_feat'))
  ) {
    return 'drops';
  }

  // Fibre: has 'cable size' or 'layer' or segment_id
  if (
    normalizedHeaders.includes('cable size') ||
    normalizedHeaders.includes('cable_size') ||
    normalizedHeaders.includes('layer') ||
    normalizedHeaders.includes('segment_id')
  ) {
    return 'fibre';
  }

  // Poles: has label_1 or pole_number
  if (
    normalizedHeaders.includes('label_1') ||
    normalizedHeaders.includes('pole_number') ||
    normalizedHeaders.some(h => h.includes('pole'))
  ) {
    return 'poles';
  }

  return null;
}

/**
 * Validate import data without inserting
 */
export async function validateImport(
  data: string | Buffer,
  dataType: DataType,
  sheetName?: string
): Promise<ValidationResult> {
  const { headers, rows } = await parseExcelFile(data, sheetName);
  return validateDataset(rows, dataType, headers);
}

/**
 * Build upsert SQL for a data type
 */
function buildUpsertSQL(
  dataType: DataType,
  columns: string[],
  projectId: string
): { sql: string; conflictColumns: string[] } {
  const mapping = getMapping(dataType);
  if (!mapping) {
    throw new Error(`Unknown data type: ${dataType}`);
  }

  const tableName = mapping.tableName;
  const conflictColumns = mapping.uniqueConstraint;

  // Build column list (always include project_id)
  const allColumns = ['project_id', ...columns];
  const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(', ');

  // Build update set clause (exclude conflict columns)
  const updateColumns = columns.filter(c => !conflictColumns.includes(c));
  const updateSet = updateColumns.map(c => `${c} = EXCLUDED.${c}`).join(', ');

  const sql = `
    INSERT INTO ${tableName} (${allColumns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${conflictColumns.join(', ')})
    DO UPDATE SET ${updateSet}, updated_at = NOW()
    RETURNING id
  `;

  return { sql, conflictColumns };
}

/**
 * Import data into database
 */
export async function importData(
  data: string | Buffer,
  projectId: string,
  dataType: DataType,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };

  log.info(`Starting ${dataType} import for project ${projectId}`, {
    data: { options: opts },
  }, 'project-import');

  // Parse Excel
  const { headers, rows } = await parseExcelFile(data);

  // Validate first
  const validation = validateDataset(rows, dataType, headers);
  if (!validation.valid && !opts.skipInvalid) {
    return {
      success: false,
      dataType,
      projectId,
      stats: {
        totalRows: rows.length,
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: validation.issues.filter(i => i.severity === 'error').length,
      },
      errors: validation.issues,
      duration: Date.now() - startTime,
    };
  }

  // Validate only mode
  if (opts.validateOnly) {
    return {
      success: validation.valid,
      dataType,
      projectId,
      stats: {
        totalRows: rows.length,
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: validation.issues.filter(i => i.severity === 'error').length,
      },
      errors: validation.issues,
      duration: Date.now() - startTime,
    };
  }

  // Get database connection
  const mapping = getMapping(dataType);
  if (!mapping) {
    throw new Error(`Unknown data type: ${dataType}`);
  }

  const client = await createClient();

  const stats: ImportStats = {
    totalRows: rows.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  const errors: ImportError[] = [];

  try {
    // Clear existing data if requested
    if (opts.clearExisting) {
      await client.query(`DELETE FROM ${mapping.tableName} WHERE project_id = $1`, [projectId]);
      log.info(`Cleared existing ${dataType} data for project ${projectId}`, {}, 'project-import');
    }

    // Process in batches
    const batchSize = opts.batchSize || 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const rowNumber = i + j + 1;
        const row = batch[j];

        if (!row) {
          stats.skipped++;
          continue;
        }

        // Skip rows without required identifier
        if (!hasRequiredIdentifier(row, dataType)) {
          stats.skipped++;
          continue;
        }

        // Validate and transform row
        const validated = validateRow(row, dataType, rowNumber);

        // Check for critical errors
        const criticalErrors = validated.errors.filter(e => e.severity === 'error');
        if (criticalErrors.length > 0 && !opts.skipInvalid) {
          errors.push(...criticalErrors);
          stats.errors++;
          continue;
        }

        // Insert/update row
        try {
          const columns = Object.keys(validated.data).filter(k => k !== 'raw_data' || mapping.fields.some(f => f.dbColumn === 'raw_data'));
          const values = [projectId, ...columns.map(c => validated.data[c])];

          // Build dynamic upsert based on available columns
          const columnList = ['project_id', ...columns];
          const placeholders = columnList.map((_, idx) => `$${idx + 1}`).join(', ');
          const conflictCols = mapping.uniqueConstraint.join(', ');
          const updateCols = columns
            .filter(c => !mapping.uniqueConstraint.includes(c))
            .map(c => `${c} = EXCLUDED.${c}`)
            .join(', ');

          const upsertSql = `
            INSERT INTO ${mapping.tableName} (${columnList.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT (${conflictCols})
            DO UPDATE SET ${updateCols}${updateCols ? ', ' : ''}updated_at = NOW()
          `;

          await client.query(upsertSql, values);
          stats.imported++;
        } catch (err) {
          const error = err as Error;
          errors.push({
            row: rowNumber,
            field: '',
            value: validated.data,
            message: error.message,
            severity: 'error',
          });
          stats.errors++;

          log.warn(`Failed to import row ${rowNumber}`, {
            data: { error: error.message },
          }, 'project-import');
        }
      }

      // Log progress
      const processed = Math.min(i + batchSize, rows.length);
      log.info(`Processed ${processed}/${rows.length} rows`, {
        data: { stats },
      }, 'project-import');
    }
  } finally {
    await client.end();
  }

  const duration = Date.now() - startTime;

  log.info(`Import completed`, {
    data: {
      dataType,
      projectId,
      stats,
      duration: `${duration}ms`,
    },
  }, 'project-import');

  return {
    success: stats.errors === 0,
    dataType,
    projectId,
    stats,
    errors,
    duration,
  };
}

/**
 * Import multiple data types from a combined file
 */
export async function importMultiple(
  data: string | Buffer,
  projectId: string,
  options: ImportOptions = {}
): Promise<Map<DataType, ImportResult>> {
  const results = new Map<DataType, ImportResult>();
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, {
    type: typeof data === 'string' ? 'base64' : 'buffer',
  });

  // Try each sheet
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    if (jsonData.length === 0) continue;

    const firstRow = jsonData[0];
    if (!firstRow) continue;

    const headers = Object.keys(firstRow);
    const dataType = detectDataType(headers);

    if (dataType && !results.has(dataType)) {
      log.info(`Detected ${dataType} in sheet "${sheetName}"`, {}, 'project-import');

      // Re-parse this specific sheet
      const result = await importData(data, projectId, dataType, {
        ...options,
        // Sheet name would need to be passed if we want to target specific sheet
      });

      results.set(dataType, result);
    }
  }

  return results;
}

/**
 * Get import status for a project
 */
export async function getProjectImportStatus(
  projectId: string
): Promise<{ drops: number; poles: number; fibre: number }> {
  const client = await createClient();

  try {
    const [dropsResult, polesResult, fibreResult] = await Promise.all([
      client.query('SELECT COUNT(*) as count FROM drops WHERE project_id = $1', [projectId]),
      client.query('SELECT COUNT(*) as count FROM poles WHERE project_id = $1', [projectId]),
      client.query('SELECT COUNT(*) as count FROM fibre_segments WHERE project_id = $1', [projectId]),
    ]);

    return {
      drops: Number(dropsResult.rows[0]?.count || 0),
      poles: Number(polesResult.rows[0]?.count || 0),
      fibre: Number(fibreResult.rows[0]?.count || 0),
    };
  } finally {
    await client.end();
  }
}
